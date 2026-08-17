/**
 * GET /api/v1/billing/usage — the current billing owner's usage vs. plan caps.
 *
 * Agent quota / usage meters (not Polar checkout). Every meter uses the
 * shared entitlement helpers so used/limit/unlimited match the gates.
 * Numbers come from {@link resolveOwnerUsage}.
 *
 * Auth mirrors the other billing routes: resolveBillingOwner() throws
 * UNAUTHORIZED (→ 401 via mapConnectionApiError) when Clerk is not configured.
 * Cloud anonymous visitors are the exception: they get a slim Guest payload
 * keyed by the per-IP `guest:<hash>` owner so the agent quota chip can render.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { LimitCheck } from '@/lib/billing/entitlements'

import { clientIpKey } from '@/lib/api/rate-limiter'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { getAiUsageToday } from '@/lib/billing/ai-usage-store'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkAiDailyLimit,
  checkHostLimit,
  checkSeatLimit,
  hostOverageUsd,
} from '@/lib/billing/entitlements'
import { getGuestAiPlan, guestOwnerIdFromIp } from '@/lib/billing/guest-ai'
import { resolveOwnerUsage } from '@/lib/billing/owner-usage'
import { resolveOwnerSubscription } from '@/lib/billing/user-subscription'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { ConversationStoreError } from '@/lib/conversation-store/types'

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

const UNLIMITED_METER: UsageMeter = {
  used: 0,
  limit: null,
  unlimited: true,
}

async function guestUsageResponse(request: Request): Promise<Response> {
  const guestOwnerId = await guestOwnerIdFromIp(clientIpKey(request))
  const plan = getGuestAiPlan()
  const aiUsedToday = await getAiUsageToday(guestOwnerId)
  const guestLimit = plan.aiRequestsPerDay
  return createSuccessResponse({
    planId: 'guest',
    planName: 'Guest',
    hosts: UNLIMITED_METER,
    seats: UNLIMITED_METER,
    aiMessages: {
      used: aiUsedToday,
      limit: guestLimit,
      unlimited: guestLimit == null,
    },
    aiSpentThisMonth: 0,
    aiMonthlyUsdBudget: null,
    hostOverageThisMonth: 0,
    hostOverageUsd: 0,
    renewal: {
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      status: 'none',
      billingPeriod: null,
    },
  })
}

async function handleGet(request: Request): Promise<Response> {
  try {
    const owner = await resolveBillingOwner()
    const userId = await resolveConnectionUserId()

    const [usage, sub] = await Promise.all([
      resolveOwnerUsage(owner, userId),
      resolveOwnerSubscription(owner.id),
    ])
    const {
      plan,
      hostsUsed,
      seatsUsed,
      aiUsedToday,
      aiSpentThisMonth,
      hostOverageThisMonth,
    } = usage

    return createSuccessResponse({
      planId: plan.id,
      planName: plan.name,
      hosts: toMeter(checkHostLimit(plan, hostsUsed)),
      seats: toMeter(checkSeatLimit(plan, seatsUsed)),
      aiMessages: toMeter(checkAiDailyLimit(plan, aiUsedToday)),
      aiSpentThisMonth,
      aiMonthlyUsdBudget: plan.aiMonthlyUsdBudget,
      hostOverageThisMonth,
      hostOverageUsd: hostOverageUsd(plan, hostOverageThisMonth),
      renewal: {
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        status: sub?.status ?? 'none',
        billingPeriod: sub?.billingPeriod ?? null,
      },
    })
  } catch (error) {
    if (
      error instanceof ConversationStoreError &&
      error.code === 'UNAUTHORIZED' &&
      isCloudModeServer()
    ) {
      return guestUsageResponse(request)
    }
    return mapConnectionApiError(error, ROUTE)
  }
}

export const Route = createFileRoute('/api/v1/billing/usage')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

export { handleGet as __handleGetForTests }
