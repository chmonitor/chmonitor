/**
 * applySubscription — the framework-agnostic Polar `subscription.*` flow.
 *
 * This is the single source of truth for how a Polar subscription event maps to
 * a billing owner and persists to D1, extracted from the dashboard's
 * `routes/api/v1/webhooks/polar.ts` so the dashboard Worker and the cloud-hooks
 * Worker apply IDENTICAL logic (behaviour cannot fork during the migration).
 *
 * Everything runtime-specific — Clerk org creation, Polar customer re-keying,
 * the D1 write (retry-wrapped), negative-cache invalidation, the PostHog funnel
 * event, the audit-log write, and logging — is injected via `deps`. The core
 * only owns the ORCHESTRATION: owner resolution (`user_*` first paid event →
 * lazy org + re-key; `org_*` direct), the live/paid distinction, and the gating
 * of the funnel + audit side effects.
 */

import type { PlanId } from '@chm/pricing'
import type { OwnerType, UpsertSubscriptionInput } from './subscription-store'
import type { BillingPeriod } from './types'

/** Polar Subscription shape (subset) carried by subscription.* events. */
export interface PolarSubscriptionData {
  id: string
  status: string
  recurringInterval?: string | null
  currentPeriodEnd?: Date | string | null
  cancelAtPeriodEnd?: boolean | null
  productId: string
  customerId: string
  customer?: { externalId?: string | null } | null
  /**
   * Copied onto the subscription from the checkout's metadata at creation.
   * Carries `posthogDistinctId` when the browser attached one at checkout time
   * so the funnel's `upgrade_completed` event stitches onto the same distinct
   * id as the rest of the funnel instead of the shared server id.
   */
  metadata?: Record<string, unknown> | null
}

/** Collaborators injected by each Worker. All async ones are best-effort. */
export interface ApplySubscriptionDeps {
  /** Env-driven reverse map: Polar product id → our plan + period, or null. */
  planForProductId(
    productId: string
  ): { planId: PlanId; period: BillingPeriod } | null
  /**
   * Lazily resolve/create a Clerk org for a user's first PAID event. Returns
   * the org id, or null when org creation failed (caller falls back to the user
   * owner so billing is never lost). Idempotent.
   */
  ensureOrgForUser(userId: string): Promise<string | null>
  /** Re-key the Polar customer's externalId from userId to the new orgId. */
  rekeyCustomerToOrg(customerId: string, orgId: string): Promise<void>
  /** Persist the row (the caller wraps its own retry / non-fatal semantics). */
  upsertSubscription(input: UpsertSubscriptionInput): Promise<void>
  /** Clear a negative-cache entry so the next entitlement read reaches Polar. */
  invalidateNegativeCache(id: string): void
  /**
   * A brand-new PAID subscription just went live (`subscription.created`).
   * `distinctId` is the browser's PostHog id when present (else undefined).
   */
  onUpgradeCompleted(info: {
    planId: string
    period: BillingPeriod
    distinctId?: string
  }): Promise<void>
  /** Best-effort org-scoped audit trail for a subscription change. */
  logBillingAudit(info: {
    orgId: string
    planId: string
    status: string
    subscriptionId: string
    canceled: boolean
  }): Promise<void>
  logInfo(message: string, meta?: unknown): void
  logError(message: string, meta?: unknown): void
}

export function toUnixSeconds(
  value: Date | string | null | undefined
): number | null {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/**
 * @param eventTimestamp Unix seconds from the webhook envelope's `timestamp` —
 *   feeds the monotonic write guard so an out-of-order/replayed older delivery
 *   can't overwrite newer state.
 * @param eventType The raw Polar event type (e.g. `subscription.created`) —
 *   used only to gate the `upgrade_completed` funnel event so a renewal/
 *   plan-change `subscription.updated` doesn't double-count as a new upgrade.
 */
export async function applySubscription(
  data: PolarSubscriptionData,
  eventTimestamp: number | null,
  eventType: string | undefined,
  deps: ApplySubscriptionDeps
): Promise<void> {
  const externalId = data.customer?.externalId
  if (!externalId) {
    deps.logInfo('[polar-webhook] subscription without externalId; skipping', {
      subscriptionId: data.id,
    })
    return
  }

  const mapped = deps.planForProductId(data.productId)
  if (!mapped) {
    // An unmapped product is a config/deploy mismatch (a new Polar product
    // without a CHM_POLAR_PRODUCT_* env mapping) and must be visible/alertable,
    // not buried at info level.
    deps.logError(
      '[polar-webhook] unknown Polar product id; no plan mapping — skipping',
      { productId: data.productId, subscriptionId: data.id, externalId }
    )
    return
  }

  // A subscription is "live" while active/trialing. Only paid plans trigger
  // lazy Clerk-org creation (the Free plan is user-scoped by design). Free rows
  // persist under the user id so the create-connection subscription gate finds
  // them.
  const isLive = new Set(['active', 'trialing']).has(data.status)
  const isPaidLive = isLive && mapped.planId !== 'free'

  // Determine billing owner: org or user.
  let ownerId = externalId
  let ownerType: OwnerType = 'user'

  if (externalId.startsWith('org_')) {
    ownerType = 'org'
  } else if (externalId.startsWith('user_') && isPaidLive) {
    const orgId = await deps.ensureOrgForUser(externalId)
    if (orgId) {
      ownerId = orgId
      ownerType = 'org'
      await deps.rekeyCustomerToOrg(data.customerId, orgId)
    }
    // If orgId is null: keep ownerId=userId, ownerType='user' (billing
    // preserved under userId; org creation can be retried manually).
  }

  // Cache write. The caller's `upsertSubscription` dep owns retry + non-fatal
  // semantics; here we still swallow a final failure so Polar doesn't retry the
  // event forever on a 500 (Polar remains source of truth, reconcile self-heals).
  try {
    await deps.upsertSubscription({
      userId: ownerId,
      ownerType,
      planId: mapped.planId,
      billingPeriod: mapped.period,
      status: data.status,
      polarSubscriptionId: data.id,
      polarCustomerId: data.customerId,
      currentPeriodEnd: toUnixSeconds(data.currentPeriodEnd),
      cancelAtPeriodEnd: Boolean(data.cancelAtPeriodEnd),
      eventTimestamp,
    })
  } catch (err) {
    deps.logError(
      '[polar-webhook] D1 cache write failed after retry (non-fatal — Polar remains source of truth)',
      { ownerId, ownerType, planId: mapped.planId, err }
    )
  }

  // The subscription just became live — clear any negative-cache entry so the
  // next entitlement read reaches Polar. Invalidate both the raw externalId and
  // the resolved ownerId (an org, once re-keyed) since they can differ.
  if (isLive) {
    deps.invalidateNegativeCache(externalId)
    if (ownerId !== externalId) deps.invalidateNegativeCache(ownerId)
  }

  // Funnel event: a brand-new PAID subscription just went live. Scoped to
  // `subscription.created` so renewals/field changes on `subscription.updated`
  // don't double-count.
  if (isPaidLive && eventType === 'subscription.created') {
    const posthogDistinctId = data.metadata?.posthogDistinctId
    await deps.onUpgradeCompleted({
      planId: mapped.planId,
      period: mapped.period,
      distinctId:
        typeof posthogDistinctId === 'string' && posthogDistinctId
          ? posthogDistinctId
          : undefined,
    })
  }

  // Best-effort audit trail — org-scoped only (a user-type owner has no org).
  if (ownerType === 'org') {
    const canceled = data.status === 'canceled' || data.status === 'revoked'
    await deps.logBillingAudit({
      orgId: ownerId,
      planId: mapped.planId,
      status: data.status,
      subscriptionId: data.id,
      canceled,
    })
  }

  deps.logInfo('[polar-webhook] applied subscription', {
    externalId,
    ownerId,
    ownerType,
    planId: mapped.planId,
    status: data.status,
  })
}
