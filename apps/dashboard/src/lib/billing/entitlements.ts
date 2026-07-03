/**
 * Entitlements — the single place that turns a {@link Plan} into yes/no limit
 * decisions. Every server-side "can this owner do X right now?" check should go
 * through one of these helpers instead of poking at `plan.hosts` inline, so the
 * limit semantics (`null` = unlimited, boundary handling, the error shape the
 * UI reads) stay identical across host caps, seat caps, alert-rule caps, and the
 * two AI meters (daily request trial + monthly USD budget).
 *
 * Pure and synchronous: callers resolve the plan (see `user-subscription.ts`)
 * and the current usage, then pass both in. OSS/self-host never reaches here —
 * when auth is `none` everything is authorized and unlimited.
 */

import type { Plan, PlanCapability, PlanId } from './plans'

import { planHasCapability } from './plans'

/** Stable machine codes surfaced in API error `details.reason`. */
export type LimitReason =
  | 'host_limit'
  | 'seat_limit'
  | 'alert_rule_limit'
  | 'ai_daily_limit'
  | 'ai_budget_limit'

export interface LimitCheck {
  /** True when the next unit of usage is permitted. */
  allowed: boolean
  /** The cap, or null when the plan grants unlimited usage. */
  limit: number | null
  /** Usage counted so far (hosts kept, seats taken, USD spent, …). */
  used: number
  /** Units left before the cap, or null when unlimited. Never negative. */
  remaining: number | null
  /** True when the plan does not cap this dimension at all. */
  unlimited: boolean
  reason: LimitReason
  planId: PlanId
  planName: string
}

/**
 * Core count-based check. `used` is the amount already consumed; the helper asks
 * "is there room for one more?" — i.e. `used < limit`. A null limit is unlimited.
 *
 * For the AI USD budget the "unit" is a dollar and `used` is dollars already
 * spent; the same `used < limit` test answers "is there budget left to spend?".
 */
function checkCount(
  plan: Plan,
  used: number,
  limit: number | null,
  reason: LimitReason
): LimitCheck {
  const safeUsed = Number.isFinite(used) && used > 0 ? used : 0
  if (limit == null) {
    return {
      allowed: true,
      limit: null,
      used: safeUsed,
      remaining: null,
      unlimited: true,
      reason,
      planId: plan.id,
      planName: plan.name,
    }
  }
  return {
    allowed: safeUsed < limit,
    limit,
    used: safeUsed,
    remaining: Math.max(0, limit - safeUsed),
    unlimited: false,
    reason,
    planId: plan.id,
    planName: plan.name,
  }
}

/** Can this owner keep one more ClickHouse connection? */
export function checkHostLimit(plan: Plan, currentHosts: number): LimitCheck {
  return checkCount(plan, currentHosts, plan.hosts, 'host_limit')
}

/** Result of a soft-cap host check — distinct from {@link LimitCheck}: it never
 * blocks a plan that publishes an overage policy, and instead reports how many
 * hosts past the included allowance are billable this add. */
export interface HostSoftCapCheck {
  /** True unless this is a Free-tier (or otherwise hard-capped) add past the limit. */
  allowed: boolean
  /** Billable overage hosts if this add is kept — 0 while under the included allowance. */
  overageHosts: number
}

/**
 * Can this owner add one more host, and is it billable overage?
 *
 * Unlike {@link checkHostLimit} (a hard boundary), this reflects the
 * land-and-expand policy: plans that publish `plan.hostOverage` soft-cap —
 * adding past `plan.hosts` is always `allowed`, and the caller must meter the
 * returned `overageHosts` (see `host-usage-store.ts` `recordHostOverage`).
 * Plans with `hostOverage: null` (Free) hard-cap: `allowed: false` once
 * `currentHosts` reaches `plan.hosts`, matching `checkHostLimit`.
 * `plan.hosts: null` (Enterprise/unlimited) is always allowed with no overage.
 */
export function checkHostSoftCap(
  plan: Plan,
  currentHosts: number
): HostSoftCapCheck {
  const safeUsed =
    Number.isFinite(currentHosts) && currentHosts > 0 ? currentHosts : 0
  if (plan.hosts == null || safeUsed < plan.hosts) {
    return { allowed: true, overageHosts: 0 }
  }
  if (plan.hostOverage != null) {
    // The new host itself is billable overage: at exactly the included count
    // (safeUsed === plan.hosts) this is the 1st overage host.
    return { allowed: true, overageHosts: safeUsed - plan.hosts + 1 }
  }
  return { allowed: false, overageHosts: 0 }
}

/** Can this owner add one more team seat? */
export function checkSeatLimit(plan: Plan, currentSeats: number): LimitCheck {
  return checkCount(plan, currentSeats, plan.seats, 'seat_limit')
}

/**
 * Monthly USD owed for host overage: `overageHosts * plan.hostOverage.usdPer`.
 * 0 when the plan has no overage policy (Free hard-caps; Enterprise is
 * unlimited) or when `overageHosts` is non-positive.
 */
export function hostOverageUsd(plan: Plan, overageHosts: number): number {
  if (plan.hostOverage == null) return 0
  const safeHosts =
    Number.isFinite(overageHosts) && overageHosts > 0 ? overageHosts : 0
  return safeHosts * plan.hostOverage.usdPer
}

/** Can this owner create one more alert rule? (`alertRules: 0` ⇒ never.) */
export function checkAlertRuleLimit(
  plan: Plan,
  currentRules: number
): LimitCheck {
  return checkCount(plan, currentRules, plan.alertRules, 'alert_rule_limit')
}

/**
 * AI agent daily message meter. Every tier now publishes a daily included-message
 * allowance (`aiRequestsPerDay`): Free 5, Pro 100, Max 1,000, Enterprise null.
 *
 * Blocking differs by overage policy:
 * - Free (`aiOverage: null`) → HARD cap: once today's messages hit the limit the
 *   check denies and nudges an upgrade.
 * - Pro/Max (`aiOverage` set) → SOFT cap: the daily allowance is "included", and
 *   messages past it are billed as overage ($5 / 2,000), so the check stays
 *   `allowed: true` while still reporting `used`/`limit` for the UI meter.
 *   (Metered overage billing isn't wired yet — this keeps paid users unblocked.)
 * - Enterprise (`aiRequestsPerDay: null`) → unlimited.
 */
export function checkAiDailyLimit(
  plan: Plan,
  requestsToday: number
): LimitCheck {
  const base = checkCount(
    plan,
    requestsToday,
    plan.aiRequestsPerDay,
    'ai_daily_limit'
  )
  // Paid tiers bill overage past the included allowance — never hard-block.
  if (plan.aiOverage) return { ...base, allowed: true }
  return base
}

/**
 * Monthly LLM spend meter. `spentUsd` is what has been spent this billing month;
 * the check answers "is there budget left?". `aiMonthlyUsdBudget: null` is
 * Enterprise BYOK / unlimited.
 */
export function checkAiBudget(plan: Plan, spentUsd: number): LimitCheck {
  return checkCount(plan, spentUsd, plan.aiMonthlyUsdBudget, 'ai_budget_limit')
}

/** A human-readable upgrade nudge for a tripped limit. */
export function limitMessage(check: LimitCheck): string {
  const { planName } = check
  switch (check.reason) {
    case 'host_limit':
      return `Your ${planName} plan includes ${check.limit} host${check.limit === 1 ? '' : 's'}. Upgrade your plan to connect more.`
    case 'seat_limit':
      return `Your ${planName} plan includes ${check.limit} seat${check.limit === 1 ? '' : 's'}. Upgrade your plan to invite more teammates.`
    case 'alert_rule_limit':
      return check.limit === 0
        ? `Alert rules are not available on the ${planName} plan. Upgrade to start alerting.`
        : `Your ${planName} plan includes ${check.limit} alert rule${check.limit === 1 ? '' : 's'}. Upgrade your plan to add more.`
    case 'ai_daily_limit':
      return `You've reached the ${planName} plan's daily AI limit of ${check.limit} requests. Upgrade for a higher allowance, or try again tomorrow.`
    case 'ai_budget_limit':
      return `You've used your ${planName} plan's monthly AI budget of $${check.limit}. Upgrade for a higher allowance, or wait for the next billing cycle.`
  }
}

/**
 * Capability gate. Returns true when the plan unlocks `capability`. Thin wrapper
 * over {@link planHasCapability} so capability checks and limit checks share one
 * import surface.
 */
export function hasCapability(plan: Plan, capability: PlanCapability): boolean {
  return planHasCapability(plan.id, capability)
}

/**
 * Oldest timestamp (ms epoch) a plan may read history back to. `retentionDays:
 * null` is custom/unbounded and returns null (no cutoff — caller imposes none).
 */
export function retentionCutoffMs(
  plan: Plan,
  now: number = Date.now()
): number | null {
  if (plan.retentionDays == null) return null
  return now - plan.retentionDays * 24 * 60 * 60 * 1000
}

/** Whether a timestamp (ms epoch) is within the plan's retention window. */
export function isWithinRetention(
  plan: Plan,
  timestampMs: number,
  now: number = Date.now()
): boolean {
  const cutoff = retentionCutoffMs(plan, now)
  if (cutoff == null) return true
  return timestampMs >= cutoff
}
