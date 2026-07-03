/**
 * Shared owner usage resolution — the internal resolvers behind both
 * GET /api/v1/billing/usage and POST /api/v1/billing/can-downgrade, factored
 * out so the two routes read hosts/seats/AI usage through ONE code path
 * instead of drifting apart (what the usage card shows vs. what
 * can-downgrade compares against).
 *
 * Every resolver is defensive — a store/Clerk hiccup degrades that one meter
 * to 0 (or 1 seat) rather than throwing, so a transient failure can only
 * UNDER-count usage (never wrongly flag/block a paying owner).
 */

import type { BillingOwner } from './billing-owner'
import type { Plan } from './plans'

import { getAiSpendThisMonth, getAiUsageToday } from './ai-usage-store'
import { getHostOverageThisMonth } from './host-usage-store'
import { countOwnerHosts } from './org-host-count'
import { getPlanForOwner } from './user-subscription'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'

/** Current plan + consumption across every metered dimension for a billing owner. */
export interface OwnerUsage {
  plan: Plan
  hostsUsed: number
  seatsUsed: number
  aiUsedToday: number
  aiSpentThisMonth: number
  hostOverageThisMonth: number
}

/**
 * Hosts consumed by the owner (pooled across org members for org owners). Falls
 * back to 0 when the connection store can't be resolved so the caller survives.
 */
async function resolveHostsUsed(
  owner: BillingOwner,
  userId: string
): Promise<number> {
  try {
    const store = await resolveConnectionStore()
    const usage = await countOwnerHosts(owner, store, userId)
    return usage.count
  } catch {
    return 0
  }
}

/**
 * Seats consumed. A user-scoped (free) owner is always a single seat; an org
 * owner counts its current Clerk members. Fail-safe to 1 so a Clerk hiccup can
 * only under-count (never wrongly show an over-limit meter).
 */
async function resolveSeatsUsed(owner: BillingOwner): Promise<number> {
  if (owner.type !== 'org') return 1
  try {
    const { clerkClient } = await import('@clerk/tanstack-react-start/server')
    const memberships =
      await clerkClient().organizations.getOrganizationMembershipList({
        organizationId: owner.id,
        limit: 100,
      })
    return memberships.data.length || 1
  } catch {
    return 1
  }
}

async function resolveAiUsedToday(ownerId: string): Promise<number> {
  try {
    return await getAiUsageToday(ownerId)
  } catch {
    return 0
  }
}

/**
 * USD `ownerId` has spent on AI overage this month. Defensive like the other
 * meters — a store hiccup degrades to 0 rather than failing the caller.
 */
async function resolveAiSpentThisMonth(ownerId: string): Promise<number> {
  try {
    return await getAiSpendThisMonth(ownerId)
  } catch {
    return 0
  }
}

/**
 * Peak billable overage host count `ownerId` has recorded this month (plan
 * 18). Defensive like the other meters — a store hiccup degrades to 0.
 */
async function resolveHostOverageThisMonth(ownerId: string): Promise<number> {
  try {
    return await getHostOverageThisMonth(ownerId)
  } catch {
    return 0
  }
}

/** Resolve an owner's current plan and consumption across every metered dimension. */
export async function resolveOwnerUsage(
  owner: BillingOwner,
  userId: string
): Promise<OwnerUsage> {
  const [
    plan,
    hostsUsed,
    seatsUsed,
    aiUsedToday,
    aiSpentThisMonth,
    hostOverageThisMonth,
  ] = await Promise.all([
    getPlanForOwner(owner.id),
    resolveHostsUsed(owner, userId),
    resolveSeatsUsed(owner),
    resolveAiUsedToday(owner.id),
    resolveAiSpentThisMonth(owner.id),
    resolveHostOverageThisMonth(owner.id),
  ])
  return {
    plan,
    hostsUsed,
    seatsUsed,
    aiUsedToday,
    aiSpentThisMonth,
    hostOverageThisMonth,
  }
}
