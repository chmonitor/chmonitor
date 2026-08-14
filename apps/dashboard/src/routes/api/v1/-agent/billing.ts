/**
 * AI usage enforcement (cloud only) for POST /api/v1/agent: daily message
 * meter + monthly USD budget, plus the idempotent reservation release the
 * stream path needs.
 *
 * Extracted from `handlePost` in issue #2885. Cloud guests are gated against
 * a per-IP `guest:<hash>` owner (see `lib/billing/guest-ai.ts`); OSS still
 * skips silently.
 */

import type { Plan } from '@/lib/billing/plans'

import { jsonErrorResponse } from './errors'
import {
  getAiSpendThisMonth,
  recordByokActivation,
  releaseAiUsage,
  reserveAiUsage,
} from '@/lib/billing/ai-usage-store'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import {
  checkAiBudget,
  checkAiDailyLimit,
  limitMessage,
} from '@/lib/billing/entitlements'
import {
  getGuestAiPlan,
  guestDailyLimitMessage,
  guestOwnerIdFromIp,
} from '@/lib/billing/guest-ai'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'

export type AiUsageGate =
  | { readonly ok: false; readonly response: Response }
  | {
      readonly ok: true
      readonly billingOwnerId: string | null
      readonly resolvedPlan: Plan | null
      /** Idempotent: releases at most one reserved daily slot. */
      readonly releaseReservationOnce: () => Promise<void>
    }

export interface AiUsageGateOptions {
  /** Client IP from `clientIpKey(request)` — used to derive a guest owner id. */
  readonly ip?: string
  /**
   * Precomputed `guest:<hash>` owner id. When set (Cloud + anonymous), the
   * catch-skip path reserves against this key instead of failing open.
   */
  readonly guestOwnerId?: string
}

/**
 * Cloud-anonymous daily cap. OSS / missing identity → null (caller skips).
 * Same reserve-then-check shape as the signed-in Free path.
 */
async function tryGuestAiUsageGate(
  options: AiUsageGateOptions
): Promise<AiUsageGate | null> {
  if (!isCloudModeServer()) return null
  const guestOwnerId =
    options.guestOwnerId ??
    (options.ip ? await guestOwnerIdFromIp(options.ip) : null)
  if (!guestOwnerId) return null

  const plan = getGuestAiPlan()
  const reservedCount = await reserveAiUsage(guestOwnerId)
  let reservedDailyUsage = false
  if (reservedCount != null && plan.aiRequestsPerDay != null) {
    reservedDailyUsage = true
    const check = checkAiDailyLimit(plan, reservedCount - 1)
    if (!check.allowed) {
      await releaseAiUsage(guestOwnerId)
      const limit = check.limit ?? plan.aiRequestsPerDay
      return {
        ok: false,
        response: jsonErrorResponse(
          {
            error: guestDailyLimitMessage(limit),
            details: {
              reason: 'guest_daily_limit',
              limit,
            },
          },
          402
        ),
      }
    }
  }

  let usageReleased = false
  const releaseReservationOnce = async (): Promise<void> => {
    if (usageReleased || !reservedDailyUsage) return
    usageReleased = true
    await releaseAiUsage(guestOwnerId)
  }

  return {
    ok: true,
    billingOwnerId: guestOwnerId,
    resolvedPlan: plan,
    releaseReservationOnce,
  }
}

/**
 * Apply the AI usage gate.
 *
 * `resolveBillingOwner()` throws when Clerk is not configured (self-hosted),
 * so the whole block is wrapped in try/catch — OSS deployments skip silently.
 * On Cloud, an unsigned visitor is gated against a per-IP guest owner id
 * (`guest:<hash>`) with a dedicated daily cap, not Polar.
 *
 * `billingOwnerId` / `resolvedPlan` are returned so the stream can (a) meter
 * the actual estimatedCostUsd as overage once the generation succeeds, and (b)
 * roll back the daily reservation if generation fails before it produces any
 * output.
 */
export async function applyAiUsageGate(
  byok: boolean,
  options: AiUsageGateOptions = {}
): Promise<AiUsageGate> {
  let billingOwnerId: string | null = null
  let resolvedPlan: Plan | null = null
  let reservedDailyUsage = false

  if (byok) {
    // BYOK bypasses included-credit metering entirely: no daily reservation, no
    // monthly budget check, no overage. billingOwnerId stays null so the stream
    // path never meters this request. Best-effort record the activation (cloud
    // only) so BYOK-vs-included-credit conversion is measurable — a no-op on
    // OSS / when no Clerk owner resolves.
    try {
      const owner = await resolveBillingOwner()
      await recordByokActivation(owner.id)
    } catch {
      // Not cloud / no Clerk owner → nothing to record; self-hosted stays whole.
    }
  } else {
    try {
      const owner = await resolveBillingOwner()
      const plan = await getPlanForOwner(owner.id)
      billingOwnerId = owner.id
      resolvedPlan = plan

      // Monthly LLM spend budget — hard cap (null = Enterprise BYOK / unlimited).
      if (plan.aiMonthlyUsdBudget != null) {
        const spentUsd = await getAiSpendThisMonth(owner.id)
        const budget = checkAiBudget(plan, spentUsd)
        if (!budget.allowed) {
          return {
            ok: false,
            response: jsonErrorResponse(
              {
                error: limitMessage(budget),
                details: {
                  planId: budget.planId,
                  limit: budget.limit ?? plan.aiMonthlyUsdBudget,
                  reason: budget.reason,
                },
              },
              402
            ),
          }
        }
      }

      // Daily message meter — reserve one slot atomically, then decide. The
      // reservation (post-increment count) is rolled back below if it exceeds the
      // hard cap, and again in the stream if generation fails before starting.
      if (plan.aiRequestsPerDay != null) {
        const reservedCount = await reserveAiUsage(owner.id)
        if (reservedCount != null) {
          reservedDailyUsage = true
          // reservedCount is the count *after* this reservation; usage before this
          // request is reservedCount - 1.
          const check = checkAiDailyLimit(plan, reservedCount - 1)
          if (!check.allowed) {
            await releaseAiUsage(owner.id)
            reservedDailyUsage = false
            return {
              ok: false,
              response: jsonErrorResponse(
                {
                  error: limitMessage(check),
                  details: {
                    planId: check.planId,
                    limit: check.limit ?? plan.aiRequestsPerDay,
                    reason: check.reason,
                  },
                },
                402
              ),
            }
          }
        }
      }
    } catch {
      const guestGate = await tryGuestAiUsageGate(options)
      if (guestGate) return guestGate
      // OSS / not cloud / no guest identity → skip; self-hosted stays whole.
      billingOwnerId = null
      resolvedPlan = null
      reservedDailyUsage = false
    }
  }

  // Roll back the daily reservation exactly once. Hoisted here — right after
  // the reservation itself — so BOTH failure surfaces can release it: (a) a
  // pre-stream throw (MCP connect / createClickHouseAgent), where no stream
  // ever exists so onError/onEnd never run (issue #2675), and (b) the
  // streaming path, where the inner `execute` catch and the SDK's separate
  // `onError` callback can each observe a failure that produced no output
  // (e.g. an error thrown inside the merged/piped stream surfaces via
  // onError, outside the inner try/catch). releaseAiUsage floors at 0, so
  // without the idempotency guard a double-observed failure would over-refund
  // a slot.
  let usageReleased = false
  const releaseReservationOnce = async (): Promise<void> => {
    if (usageReleased) return
    if (!billingOwnerId || !reservedDailyUsage) return
    usageReleased = true
    await releaseAiUsage(billingOwnerId)
  }

  return { ok: true, billingOwnerId, resolvedPlan, releaseReservationOnce }
}
