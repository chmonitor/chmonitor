/**
 * Pure decision logic for the PaywallModal — kept out of the React component
 * so it's Bun-testable without rendering (see paywall-modal.test.tsx).
 *
 * Everything here derives from @chm/pricing plan data + the enforcement
 * registry; nothing fetches. The modal component reads these as pure
 * functions of its props.
 */
import type { BillingLimitReason } from '@/lib/api/error-handler/types'
import type { Enforcement, LimitKey } from '@/lib/billing/plan-enforcement'
import type { Plan, PlanId } from '@/lib/billing/plans'

import { LIMIT_ENFORCEMENT } from '@/lib/billing/plan-enforcement'
import { BILLING_PLAN_LIST, getPlan, PLAN_IDS } from '@/lib/billing/plans'

/** Dialog title per reason. */
export const REASON_TITLES: Record<BillingLimitReason, string> = {
  host: 'Host limit reached',
  seat: 'Seat limit reached',
  ai_daily: 'Daily AI limit reached',
  ai_budget: 'Monthly AI budget reached',
}

/** Which numeric `Plan` field each reason measures. */
const REASON_FIELD: Record<
  BillingLimitReason,
  'hosts' | 'seats' | 'aiRequestsPerDay' | 'aiMonthlyUsdBudget'
> = {
  host: 'hosts',
  seat: 'seats',
  ai_daily: 'aiRequestsPerDay',
  ai_budget: 'aiMonthlyUsdBudget',
}

/** Which `LIMIT_ENFORCEMENT` key governs each reason (same fields, named for the registry). */
const REASON_LIMIT_KEY: Record<BillingLimitReason, LimitKey> = REASON_FIELD

/**
 * Whether this reason's limit is actually gated (`enforced`) or advertised but
 * free during beta (`deferred`) — the honest-paywall source of truth. Never
 * hardcode this per reason; always read the registry so it can't drift from
 * the real gates.
 */
export function enforcementForReason(reason: BillingLimitReason): Enforcement {
  return LIMIT_ENFORCEMENT[REASON_LIMIT_KEY[reason]]
}

function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value)
}

/** Resolves a plan id from a 402 body defensively — unknown ids fall back to Free. */
export function resolveCurrentPlan(planId: string): Plan {
  return getPlan(isPlanId(planId) ? planId : 'free')
}

/** Compact cap label for the current-vs-next mini table, e.g. "3", "$5/mo", "Unlimited". */
export function formatReasonCap(
  reason: BillingLimitReason,
  plan: Plan
): string {
  const value = plan[REASON_FIELD[reason]]
  if (value === null) return 'Unlimited'
  return reason === 'ai_budget' ? `$${value}/mo` : String(value)
}

/**
 * Whether `candidate` actually unblocks a user stuck at `current`'s cap for
 * `field`. Usually that means a strictly higher (or unlimited) numeric cap —
 * but `hosts` is special: Pro/Max never hard-cap (they publish `hostOverage`
 * and soft-cap into billable overage instead), so a plan gaining an overage
 * policy unblocks a hard-capped plan even at an EQUAL included host count
 * (Free 1 host hard cap -> Pro 1 host included + overage). Without this, a
 * Free user hitting the host wall would be routed past Pro straight to Max,
 * even though Pro already removes the block.
 */
function tierClearsCap(
  current: Plan,
  candidate: Plan,
  field: 'hosts' | 'seats' | 'aiRequestsPerDay' | 'aiMonthlyUsdBudget'
): boolean {
  const currentValue = current[field]
  const candidateValue = candidate[field]
  if (candidateValue === null) return true
  if (currentValue !== null && candidateValue > currentValue) return true
  if (
    field === 'hosts' &&
    current.hostOverage == null &&
    candidate.hostOverage != null
  ) {
    return true
  }
  return false
}

/**
 * First plan after `currentPlanId` (in free -> pro -> max -> enterprise order)
 * that unblocks `reason`'s cap (see {@link tierClearsCap}). Null when the
 * current plan is already the top tier for that metric (shouldn't happen in
 * practice — Enterprise caps are all unlimited, so it never trips a 402).
 */
export function findNextTier(
  currentPlanId: string,
  reason: BillingLimitReason
): Plan | null {
  const field = REASON_FIELD[reason]
  const currentIndex = BILLING_PLAN_LIST.findIndex(
    (p) => p.id === currentPlanId
  )
  const safeIndex = currentIndex === -1 ? 0 : currentIndex
  const currentPlan = BILLING_PLAN_LIST[safeIndex]

  for (let i = safeIndex + 1; i < BILLING_PLAN_LIST.length; i++) {
    if (tierClearsCap(currentPlan, BILLING_PLAN_LIST[i], field)) {
      return BILLING_PLAN_LIST[i]
    }
  }
  return null
}

export type UpgradeAction =
  | { kind: 'checkout'; planId: 'pro' | 'max' }
  | { kind: 'portal' }
  | { kind: 'contact' }
  | { kind: 'none' }

/**
 * Mirrors the CTA branching already on the /billing page
 * (routes/(dashboard)/billing.tsx onCheckout/onPortal/mailto), so the
 * paywall's "Upgrade" button never offers an action that would fail:
 * - No next tier (already top plan for this metric) -> nothing to offer.
 * - Next tier is Enterprise -> no self-serve checkout; "Contact us" (mailto).
 * - Caller already has a paid plan -> a fresh Polar checkout errors ("already
 *   has an active subscription"); route to the customer portal instead, which
 *   prorates the plan change.
 * - Otherwise (Free -> Pro/Max) -> start a checkout for the next tier.
 */
export function resolveUpgradeAction(
  currentPlanId: string,
  nextTier: Plan | null
): UpgradeAction {
  if (!nextTier) return { kind: 'none' }
  if (nextTier.id === 'enterprise') return { kind: 'contact' }
  if (currentPlanId !== 'free') return { kind: 'portal' }
  return { kind: 'checkout', planId: nextTier.id as 'pro' | 'max' }
}
