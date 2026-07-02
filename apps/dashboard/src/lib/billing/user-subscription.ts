/**
 * Resolve a billing owner's effective plan.
 *
 * The free plan is the floor: no subscription row, no D1, or a lapsed/canceled
 * subscription all resolve to free. A paid plan only applies while its status is
 * live and (when present) the current period has not ended — so access cleanly
 * downgrades when a subscription expires without needing a separate cron.
 *
 * Org-scoped billing: paid subscriptions are stored under the Clerk org id (org_*)
 * as the billing-owner id. Use getPlanForOwner(ownerId) / getPlanIdForOwner(ownerId)
 * with the resolved billing owner from resolveBillingOwner(). The legacy
 * getUserPlan(userId) / getUserPlanId(userId) wrappers remain for call-sites that
 * only have a user id (free path — no org).
 */

import type { Plan, PlanId } from './plans'
import type { OwnerSubscription } from './polar-subscription'
import type { OwnerType, UserSubscription } from './subscription-store'

import { BILLING_PLANS, getPlan } from './plans'
import { pullOwnerSubscriptionFromPolar } from './polar-subscription'
import { getSubscription, upsertSubscription } from './subscription-store'

/** Polar statuses that still grant the paid plan. */
const LIVE_STATUSES = new Set(['active', 'trialing'])

export function isSubscriptionLive(
  sub: Pick<UserSubscription, 'status' | 'currentPeriodEnd'>,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!LIVE_STATUSES.has(sub.status)) return false
  if (sub.currentPeriodEnd != null && sub.currentPeriodEnd < nowSeconds) {
    return false
  }
  return true
}

function validPlanId(id: PlanId): PlanId {
  return BILLING_PLANS[id] ? id : 'free'
}

/**
 * Resolve the live subscription for a billing owner, or null for free.
 *
 * D1 cache first (fast path once the webhook has synced), then reconcile against
 * Polar as the source of truth — this catches missed/failed webhook deliveries
 * and an empty/cold D1, and surfaces cancel-grace (Polar keeps a cancelled-at-
 * period-end subscription "active" until the period ends). A Polar hit is
 * written through to D1 best-effort so the next read takes the fast path.
 */
export async function resolveOwnerSubscription(
  ownerId: string
): Promise<OwnerSubscription | null> {
  const cached = await getSubscription(ownerId)
  if (cached && isSubscriptionLive(cached)) {
    return {
      planId: validPlanId(cached.planId),
      billingPeriod: cached.billingPeriod,
      status: cached.status,
      currentPeriodEnd: cached.currentPeriodEnd,
      cancelAtPeriodEnd: cached.cancelAtPeriodEnd,
    }
  }

  const polar = await pullOwnerSubscriptionFromPolar(ownerId)
  if (polar) {
    // Write-through cache so the next read is a fast D1 hit. Best-effort: a
    // missing/cold D1 must never break the (already-correct) Polar read.
    const ownerType: OwnerType = ownerId.startsWith('org_') ? 'org' : 'user'
    try {
      await upsertSubscription({
        userId: ownerId,
        ownerType,
        planId: polar.planId,
        billingPeriod: polar.billingPeriod,
        status: polar.status,
        currentPeriodEnd: polar.currentPeriodEnd,
        cancelAtPeriodEnd: polar.cancelAtPeriodEnd,
      })
    } catch {
      // ignore — Polar already gave us the authoritative answer
    }
    return polar
  }

  return null
}

/**
 * Resolve the plan id for a billing owner (user or org), defaulting to free.
 * Pass the id from resolveBillingOwner() — either a Clerk user id or org id.
 */
export async function getPlanIdForOwner(ownerId: string): Promise<PlanId> {
  const sub = await resolveOwnerSubscription(ownerId)
  return sub ? validPlanId(sub.planId) : 'free'
}

/**
 * Resolve the Plan object for a billing owner (user or org), defaulting to free.
 */
export async function getPlanForOwner(ownerId: string): Promise<Plan> {
  return getPlan(await getPlanIdForOwner(ownerId))
}

/**
 * The user's current plan id, defaulting to free.
 * Thin wrapper around getPlanIdForOwner — passes userId as the owner key.
 * For routes that have a session context, prefer resolveBillingOwner() +
 * getPlanIdForOwner() to handle org-scoped subscriptions correctly.
 */
export async function getUserPlanId(userId: string): Promise<PlanId> {
  return getPlanIdForOwner(userId)
}

/**
 * The user's current Plan object, defaulting to the free plan.
 * Thin wrapper around getPlanForOwner — passes userId as the owner key.
 * For routes that have a session context, prefer resolveBillingOwner() +
 * getPlanForOwner() to handle org-scoped subscriptions correctly.
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  return getPlanForOwner(userId)
}
