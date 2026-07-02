import type { ConnectionStore } from '@/lib/connection-store/types'
import type { BillingOwner } from './billing-owner'

/** Pooled host usage for a billing owner: the count plus the member id set it was computed from. */
export interface OwnerHostUsage {
  /** Hosts counted so far — the value fed to `checkHostLimit`. */
  count: number
  /**
   * The user_ids whose connections were counted. `[actingUserId]` for a user
   * owner, or the pooled Clerk org member id list (including the acting user)
   * for an org owner. Callers pass this through to `store.create()`'s atomic
   * limit enforcement so the insert-time recount uses the SAME member set the
   * pre-check used.
   */
  memberUserIds: string[]
}

/**
 * Count the hosts (saved per-user connections) that consume a billing owner's
 * host limit — the value fed to `checkHostLimit`.
 *
 * - **User owner** → just that user's connections.
 * - **Org owner** → the host limit is POOLED across the org: count connections
 *   owned by every CURRENT member of the org. A removed member's connections
 *   drop out of the pool automatically because they're no longer enumerated —
 *   no `org_id` column, backfill, or cleanup needed. Member counts are small
 *   (Pro 3 / Max 10 seats), so this is a handful of cheap reads.
 *
 * Fail-safe: ANY error in the org path (Clerk API down, unexpected shape) falls
 * back to counting just the acting user's connections. It never throws, so a
 * billing-count hiccup can't break adding a host, and the fallback can only
 * UNDER-count (more permissive) — it will never wrongly 402 a paying org.
 */
export async function countOwnerHosts(
  owner: BillingOwner,
  store: ConnectionStore,
  actingUserId: string
): Promise<OwnerHostUsage> {
  if (owner.type !== 'org') {
    const count = (await store.list(actingUserId)).length
    return { count, memberUserIds: [actingUserId] }
  }

  try {
    const { clerkClient } = await import('@clerk/tanstack-react-start/server')
    const memberships =
      await clerkClient().organizations.getOrganizationMembershipList({
        organizationId: owner.id,
        limit: 100,
      })

    const memberIds = memberships.data
      .map((m) => m.publicUserData?.userId)
      .filter((id): id is string => Boolean(id))
    // Count the acting user even if their membership row hasn't propagated yet.
    if (!memberIds.includes(actingUserId)) memberIds.push(actingUserId)

    const counts = await Promise.all(
      memberIds.map((id) =>
        store.list(id).then((connections) => connections.length)
      )
    )
    return {
      count: counts.reduce((sum, n) => sum + n, 0),
      memberUserIds: memberIds,
    }
  } catch {
    // Permissive fallback — never block a paying org on an enumeration failure.
    const count = (await store.list(actingUserId)).length
    return { count, memberUserIds: [actingUserId] }
  }
}
