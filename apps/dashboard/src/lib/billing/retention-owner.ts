/**
 * Session-less billing-owner → retention-plan resolution for background jobs.
 *
 * `resolveBillingOwner()` (billing-owner.ts) reads the *current request session*
 * (the active Clerk org from the session JWT) and only works inside a signed-in
 * request. The retention-prune cron has no session — it iterates over raw
 * conversation `user_id`s — so it cannot use that path. Resolving the plan by the
 * bare `user_id` is WRONG for org-owned paid subscribers: paid plans are stored
 * under the Clerk **org** id (see user-subscription.ts / subscription-store.ts),
 * so a bare-user lookup misses the org subscription and resolves to free (7 days),
 * permanently deleting conversations the UI still shows on 30/90-day plans.
 *
 * This module resolves, without a session, the *effective* retention plan for a
 * given user by considering the billing owners the user could be enforced under:
 * their own user id PLUS every Clerk org they belong to. It returns the MOST
 * GENEROUS plan (longest retention; unlimited wins) among those owners, so the
 * cron never deletes history the read-filter in conversations.ts would still
 * display under the user's active org.
 *
 * Fail-safe: if the Clerk org enumeration fails, this THROWS rather than falling
 * back to the bare-user (free) plan — the cron's per-user try/catch then skips
 * pruning that user, so a transient Clerk hiccup can never cause silent deletion.
 */

import type { Plan } from './plans'

import { getPlanForOwner } from './user-subscription'

/**
 * Pick the plan with the most generous retention window.
 *
 * `retentionDays == null` means unlimited (enterprise/custom) and always wins;
 * otherwise the largest `retentionDays` wins. Returns the first plan when the
 * list has a single entry, and never returns undefined for a non-empty list.
 */
export function mostGenerousRetentionPlan(plans: Plan[]): Plan {
  if (plans.length === 0) {
    throw new Error('mostGenerousRetentionPlan requires at least one plan')
  }
  return plans.reduce((best, candidate) => {
    if (best.retentionDays == null) return best
    if (candidate.retentionDays == null) return candidate
    return candidate.retentionDays > best.retentionDays ? candidate : best
  })
}

/**
 * List the Clerk org ids a user belongs to (session-less, via the Clerk API).
 *
 * Throws when Clerk is not available or the request fails, so callers can treat
 * an enumeration failure as "unknown ownership" instead of assuming free.
 */
async function listUserOrgIds(userId: string): Promise<string[]> {
  const { clerkClient } = await import('@clerk/tanstack-react-start/server')
  const memberships = await clerkClient().users.getOrganizationMembershipList({
    userId,
    limit: 100,
  })
  return memberships.data
    .map((m) => m.organization?.id)
    .filter((id): id is string => Boolean(id))
}

/**
 * Resolve the effective retention Plan for a user without a request session.
 *
 * Considers the user's own billing owner and every Clerk org they belong to,
 * and returns the most generous plan among them (see module doc). Throws if the
 * org enumeration fails so the caller can skip pruning (fail-closed to no-delete).
 * Pass the same `planCache` across a run to share owner plan lookups.
 */
export async function resolveRetentionPlanForUser(
  userId: string,
  planCache: Map<string, Promise<Plan>> = new Map()
): Promise<Plan> {
  const orgIds = await listUserOrgIds(userId)
  const ownerIds = [userId, ...orgIds]
  // Per-run cache: an org shared by many users is looked up once. A rejected
  // lookup stays cached, so every user depending on it fails closed.
  const plans = await Promise.all(
    ownerIds.map((ownerId) => {
      let plan = planCache.get(ownerId)
      if (!plan) {
        plan = getPlanForOwner(ownerId)
        planCache.set(ownerId, plan)
      }
      return plan
    })
  )
  return mostGenerousRetentionPlan(plans)
}
