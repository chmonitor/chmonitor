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
 * exactly (`limit: null` = unlimited). The underlying consumption numbers come
 * from {@link resolveOwnerUsage} (`lib/billing/owner-usage.ts`), the SAME
 * resolver POST /api/v1/billing/can-downgrade uses, so the two routes can never
 * drift on what "current usage" means.
 *
 * Auth mirrors the other billing routes: resolveBillingOwner() throws
 * UNAUTHORIZED (→ 401 via mapConnectionApiError) when Clerk is not configured.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { LimitCheck } from '@/lib/billing/entitlements'

import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkAiDailyLimit,
  checkHostLimit,
  checkSeatLimit,
  hostOverageUsd,
} from '@/lib/billing/entitlements'
import { resolveOwnerUsage } from '@/lib/billing/owner-usage'
import { resolveOwnerSubscription } from '@/lib/billing/user-subscription'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'

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

async function handleGet(): Promise<Response> {
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
