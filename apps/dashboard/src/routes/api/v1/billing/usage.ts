/**
 * GET /api/v1/billing/usage — the current billing owner's usage vs. plan caps.
 *
 * Complements /api/v1/billing/subscription (which returns the plan + renewal
 * metadata) by adding the actual consumption the current-plan card needs to
 * render meters: hosts used/cap, seats used/cap, AI messages today/limit, plus
 * the renewal date and cancel-grace state so the UI can surface a banner.
 *
 * Every meter is computed through the shared entitlement helpers
 * ({@link checkHostLimit} / {@link checkSeatLimit} / {@link checkAiDailyLimit})
 * so the used/limit/unlimited semantics match the server-side enforcement gates
 * exactly (`limit: null` = unlimited). Each meter is resolved defensively — a
 * store/Clerk hiccup degrades that one meter to `used: 0` rather than failing
 * the whole summary, so the card still shows the plan and renewal state.
 *
 * Auth mirrors the other billing routes: resolveBillingOwner() throws
 * UNAUTHORIZED (→ 401 via mapConnectionApiError) when Clerk is not configured.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { BillingOwner } from '@/lib/billing/billing-owner'
import type { LimitCheck } from '@/lib/billing/entitlements'
import type { Plan } from '@/lib/billing/plans'

import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import {
  getAiSpendThisMonth,
  getAiUsageToday,
} from '@/lib/billing/ai-usage-store'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkAiDailyLimit,
  checkHostLimit,
  checkSeatLimit,
} from '@/lib/billing/entitlements'
import { countOwnerHosts } from '@/lib/billing/org-host-count'
import {
  getPlanForOwner,
  resolveOwnerSubscription,
} from '@/lib/billing/user-subscription'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'

const ROUTE = { route: '/api/v1/billing/usage', method: 'GET' }

/** A meter's shape as consumed by the UI. `limit: null` = unlimited. */
interface UsageMeter {
  used: number
  limit: number | null
  unlimited: boolean
}

function toMeter(check: LimitCheck): UsageMeter {
  return { used: check.used, limit: check.limit, unlimited: check.unlimited }
}

/**
 * Hosts consumed by the owner (pooled across org members for org owners). Falls
 * back to 0 when the connection store can't be resolved so the summary survives.
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
 * meters — a store hiccup degrades to 0 rather than failing the summary.
 */
async function resolveAiSpentThisMonth(ownerId: string): Promise<number> {
  try {
    return await getAiSpendThisMonth(ownerId)
  } catch {
    return 0
  }
}

async function handleGet(): Promise<Response> {
  try {
    const owner = await resolveBillingOwner()
    const userId = await resolveConnectionUserId()

    const [plan, sub, hostsUsed, seatsUsed, aiUsedToday, aiSpentThisMonth]: [
      Plan,
      Awaited<ReturnType<typeof resolveOwnerSubscription>>,
      number,
      number,
      number,
      number,
    ] = await Promise.all([
      getPlanForOwner(owner.id),
      resolveOwnerSubscription(owner.id),
      resolveHostsUsed(owner, userId),
      resolveSeatsUsed(owner),
      resolveAiUsedToday(owner.id),
      resolveAiSpentThisMonth(owner.id),
    ])

    return createSuccessResponse({
      planId: plan.id,
      planName: plan.name,
      hosts: toMeter(checkHostLimit(plan, hostsUsed)),
      seats: toMeter(checkSeatLimit(plan, seatsUsed)),
      aiMessages: toMeter(checkAiDailyLimit(plan, aiUsedToday)),
      aiSpentThisMonth,
      aiMonthlyUsdBudget: plan.aiMonthlyUsdBudget,
      renewal: {
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        status: sub?.status ?? 'none',
        billingPeriod: sub?.billingPeriod ?? null,
      },
    })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE)
  }
}

export const Route = createFileRoute('/api/v1/billing/usage')({
  server: {
    handlers: {
      GET: async () => handleGet(),
    },
  },
})
