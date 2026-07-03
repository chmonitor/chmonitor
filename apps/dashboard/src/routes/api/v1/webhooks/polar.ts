/**
 * POST /api/v1/webhooks/polar — Polar webhook receiver.
 *
 * Verifies the signature over the RAW body (validateEvent base64-encodes the
 * secret internally), then upserts the subscription row. The billing owner is
 * resolved from `customer.externalId`:
 *
 * - externalId starts with 'user_' (first-time upgrade, no org yet):
 *   1. Check if the user already has a Clerk org membership (idempotency).
 *   2. If not, create a Clerk org lazily and add the user as admin.
 *   3. Re-key the Polar customer's externalId to the orgId (customers.update
 *      by internal customer id) so `pullOwnerSubscriptionFromPolar(orgId)` —
 *      the "Polar is source of truth" fallback — can find this customer by
 *      org id from now on. Without this, the Polar lookup 404s forever for
 *      org owners and entitlement silently depends on the D1 cache never
 *      drifting.
 *   4. Upsert the subscription keyed by orgId (owner_type='org').
 *   5. Defensive fallback: if org creation fails, persist under userId so
 *      billing is never lost (owner_type='user').
 *
 * - externalId starts with 'org_' (re-subscription or upgrade on paid account):
 *   Upsert subscription keyed by orgId (owner_type='org') directly.
 *
 * The D1 cache write is retried once on failure (transient D1 blips) before
 * giving up — a silently lost row would otherwise gate a paying owner as free
 * until their next Polar reconciliation read, which is user-visible for an
 * otherwise-live subscription.
 *
 * `cancelAtPeriodEnd` and the envelope's `timestamp` (unix seconds) are
 * persisted on every write. The timestamp feeds subscription-store.ts's
 * monotonic write guard: webhook delivery is at-least-once and can arrive out
 * of order, so a late/replayed older event must never overwrite state written
 * by a newer one (e.g. a stale "canceled" landing after a fresher "active"
 * from an uncancel).
 *
 * Always 2xx on a valid, handled event so Polar doesn't retry. 400 on bad
 * signature. An unmapped/unknown Polar product is logged as an ERROR (not
 * silently dropped at info level) and skipped — we can't apply a plan we
 * don't recognize, but the event must stay visible/alertable instead of
 * vanishing into routine logs.
 *
 * Unauthenticated by design — the signature IS the auth.
 */
import { createFileRoute } from '@tanstack/react-router'

import { error as logError, log as logInfo } from '@chm/logger'
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import { logEvent } from '@/lib/audit/logEvent'
import {
  getPolarClient,
  getWebhookSecret,
  planForProductId,
} from '@/lib/billing/polar-config'
import { invalidateNegativeCache } from '@/lib/billing/polar-subscription'
import {
  type OwnerType,
  upsertSubscription,
} from '@/lib/billing/subscription-store'

/** Polar Subscription shape (subset) carried by subscription.* events. */
interface PolarSubscriptionData {
  id: string
  status: string
  recurringInterval?: string | null
  currentPeriodEnd?: Date | string | null
  cancelAtPeriodEnd?: boolean | null
  productId: string
  customerId: string
  customer?: { externalId?: string | null } | null
}

function toUnixSeconds(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/**
 * Attempt to lazily create a Clerk org for a user on their first paid event.
 * Returns the orgId if successful, null on any error (billing is saved under
 * userId as a fallback so payment is never lost).
 *
 * Idempotent: if the user already has an org membership, returns that org's id
 * without creating a duplicate.
 */
async function ensureOrgForUser(userId: string): Promise<string | null> {
  try {
    const { clerkClient } = await import('@clerk/tanstack-react-start/server')
    const client = clerkClient()

    // Check existing memberships first (idempotency guard).
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
    })
    if (memberships.data.length > 0) {
      const existingOrgId = memberships.data[0]?.organization?.id
      if (existingOrgId) {
        logInfo('[polar-webhook] user already has org; reusing', {
          userId,
          orgId: existingOrgId,
        })
        return existingOrgId
      }
    }

    // Create a new Clerk org for the buyer.
    const org = await client.organizations.createOrganization({
      name: `${userId} workspace`,
      createdBy: userId,
    })
    logInfo('[polar-webhook] created Clerk org for paid user', {
      userId,
      orgId: org.id,
    })
    return org.id
  } catch (err) {
    // Org creation is best-effort: Clerk orgs may be quota-limited or disabled.
    // Log the error but do not lose the subscription — caller falls back to userId.
    logError(
      '[polar-webhook] org creation failed; falling back to user owner',
      {
        userId,
        err,
      }
    )
    return null
  }
}

/**
 * Re-key the Polar customer's externalId from the buyer's userId to the newly
 * created orgId. Best-effort: on failure the D1 row is still correct (keyed
 * by orgId), but `pullOwnerSubscriptionFromPolar(orgId)` will 404 until this
 * is retried — logged as an error so it's alertable, not lost silently.
 */
async function rekeyCustomerToOrg(
  customerId: string,
  orgId: string
): Promise<void> {
  try {
    await getPolarClient().customers.update({
      id: customerId,
      customerUpdate: { externalId: orgId },
    })
    logInfo('[polar-webhook] re-keyed Polar customer externalId to org', {
      customerId,
      orgId,
    })
  } catch (err) {
    logError(
      '[polar-webhook] failed to re-key Polar customer externalId to org; ' +
        'Polar-truth fallback will 404 for this org until retried',
      { customerId, orgId, err }
    )
  }
}

/** Retry a D1 write once before giving up — smooths over transient blips. */
async function upsertSubscriptionWithRetry(
  input: Parameters<typeof upsertSubscription>[0]
): Promise<void> {
  try {
    await upsertSubscription(input)
  } catch (firstErr) {
    logError('[polar-webhook] D1 cache write failed; retrying once', {
      ownerId: input.userId,
      ownerType: input.ownerType,
      err: firstErr,
    })
    await upsertSubscription(input)
  }
}

/** Test-only export — exercises the full owner-resolution + persistence path. */
export async function __applySubscriptionForTests(
  data: PolarSubscriptionData,
  eventTimestamp?: number | null
): Promise<void> {
  return applySubscription(data, eventTimestamp ?? null)
}

/**
 * @param eventTimestamp Unix seconds from the webhook envelope's `timestamp`
 *   — feeds the monotonic write guard in subscription-store.ts so an
 *   out-of-order/replayed older delivery can't overwrite newer state.
 */
async function applySubscription(
  data: PolarSubscriptionData,
  eventTimestamp: number | null
): Promise<void> {
  const externalId = data.customer?.externalId
  if (!externalId) {
    logInfo('[polar-webhook] subscription without externalId; skipping', {
      subscriptionId: data.id,
    })
    return
  }

  const mapped = planForProductId(data.productId)
  if (!mapped) {
    // Not silently dropped: an unmapped product is a config/deploy mismatch
    // (a new Polar product without a CHM_POLAR_PRODUCT_* env mapping) and
    // must be visible/alertable, not buried at info level.
    logError(
      '[polar-webhook] unknown Polar product id; no plan mapping — skipping',
      { productId: data.productId, subscriptionId: data.id, externalId }
    )
    return
  }

  // planForProductId only returns PaidPlanId ('pro'|'max'); check live status.
  const isPaidPlan = new Set(['active', 'trialing']).has(data.status)

  // Determine billing owner: org or user.
  let ownerId = externalId
  let ownerType: OwnerType = 'user'

  if (externalId.startsWith('org_')) {
    // Already org-scoped (user re-subscribing on an existing paid account).
    ownerType = 'org'
  } else if (externalId.startsWith('user_') && isPaidPlan) {
    // First paid event for this user — lazily create a Clerk org.
    const orgId = await ensureOrgForUser(externalId)
    if (orgId) {
      ownerId = orgId
      ownerType = 'org'
      // Re-key the Polar customer to the org so the Polar-truth fallback
      // (pullOwnerSubscriptionFromPolar) can find it by orgId going forward —
      // otherwise every future entitlement reconciliation for this org 404s
      // against Polar and depends entirely on the D1 cache never drifting.
      await rekeyCustomerToOrg(data.customerId, orgId)
    }
    // If orgId is null, fallback: keep ownerId=userId, ownerType='user'.
    // Billing is preserved under userId; org creation can be retried manually.
  }

  // Cache write, retried once on transient failure. The dashboard also
  // reconciles entitlement straight from Polar (resolveOwnerSubscription), so
  // a write that still fails after retry must NOT fail the whole webhook —
  // otherwise Polar retries the event forever on a 500 even though the truth
  // is already in Polar (and, once re-keyed above, reachable by ownerId too).
  // Still logged loudly: a lost row means the next read pays the Polar
  // round-trip instead of hitting the D1 fast path, so it should be visible.
  try {
    await upsertSubscriptionWithRetry({
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
    logError(
      '[polar-webhook] D1 cache write failed after retry (non-fatal — Polar remains source of truth)',
      {
        ownerId,
        ownerType,
        planId: mapped.planId,
        err,
      }
    )
  }

  // The subscription just became live/paid — clear any negative-cache entry
  // so the next entitlement read reaches Polar instead of a stale "free"
  // short-circuit. Invalidate both the raw externalId (what an entitlement
  // check may have cached before checkout completed) and the resolved
  // ownerId (an org, once org re-keying applies) since they can differ.
  if (isPaidPlan) {
    invalidateNegativeCache(externalId)
    if (ownerId !== externalId) invalidateNegativeCache(ownerId)
  }

  // Best-effort audit trail — org-scoped only (a user-type owner has no org
  // to scope the row to; audit is an org-level enterprise feature). Fires
  // regardless of the D1 cache-write outcome above: Polar already confirmed
  // the event, so the audit trail shouldn't depend on our cache succeeding.
  if (ownerType === 'org') {
    const isCanceled = data.status === 'canceled' || data.status === 'revoked'
    await logEvent({
      orgId: ownerId,
      userId: null,
      event: isCanceled ? 'billing.canceled' : 'billing.plan_changed',
      resource: mapped.planId,
      action: 'update',
      result: 'success',
      metadata: { status: data.status, subscriptionId: data.id },
    })
  }

  logInfo('[polar-webhook] applied subscription', {
    externalId,
    ownerId,
    ownerType,
    planId: mapped.planId,
    status: data.status,
  })
}

async function handlePost(request: Request): Promise<Response> {
  const secret = getWebhookSecret()
  if (!secret) {
    return Response.json(
      { error: 'Billing webhook not configured' },
      { status: 501 }
    )
  }

  const body = await request.text()
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  let event: ReturnType<typeof validateEvent>
  try {
    event = validateEvent(body, headers, secret)
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return Response.json({ error: 'Invalid signature' }, { status: 403 })
    }
    logError('[polar-webhook] failed to parse event', err)
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.active':
      case 'subscription.canceled':
      case 'subscription.uncanceled':
      case 'subscription.revoked':
      case 'subscription.past_due':
        await applySubscription(
          event.data as unknown as PolarSubscriptionData,
          toUnixSeconds(event.timestamp)
        )
        break
      default:
        // Acknowledge unhandled events (checkout.*, order.*, etc.) without action.
        break
    }
  } catch (err) {
    // Persistence failed — 500 so Polar retries with backoff.
    logError('[polar-webhook] handler error', err)
    return Response.json({ error: 'Handler error' }, { status: 500 })
  }

  return Response.json({ received: true }, { status: 202 })
}

export const Route = createFileRoute('/api/v1/webhooks/polar')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
