/**
 * Daily billing summary — a once-a-day digest built from the shared D1
 * subscription store + the BILLING_PLANS pricing source of truth.
 *
 * Reports: active subscriptions by plan, new signups in the last 24h, and an
 * MRR estimate (monthly plans contribute their monthly price; yearly plans
 * contribute price/12). Pricing comes from `@chm/pricing` so the estimate can
 * never drift from the published prices.
 */

import { BILLING_PLANS, type Plan, type PlanId } from '@chm/pricing'

/** Minimal D1 subset used by the summary queries (adds `.all()`). */
export interface D1SummaryDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>
      first<T = unknown>(): Promise<T | null>
    }
  }
}

export interface PlanBreakdownRow {
  plan_id: string
  billing_period: string | null
  n: number
}

export interface SummaryData {
  /** Active/trialing subscriptions total. */
  totalActive: number
  /** Count of active subscriptions per plan id. */
  byPlan: Record<string, number>
  /** Subscriptions created in the last 24h (any status). */
  newLast24h: number
  /** Estimated monthly recurring revenue in USD. */
  mrrUsd: number
}

const ACTIVE_STATUSES = "('active','trialing')"

/**
 * Compute the MRR contribution of a group of subscriptions on the same plan +
 * period. Yearly is normalized to a monthly figure (price / 12). A plan with no
 * configured price (e.g. Free = 0, Enterprise = null) contributes 0.
 */
export function mrrForGroup(
  plan: Plan | undefined,
  period: string | null,
  count: number
): number {
  if (!plan) return 0
  if (period === 'yearly') {
    return plan.priceYearlyUsd ? (plan.priceYearlyUsd / 12) * count : 0
  }
  return plan.priceMonthlyUsd ? plan.priceMonthlyUsd * count : 0
}

/**
 * Reduce the per-(plan,period) breakdown rows into a `SummaryData`. Pure — the
 * caller supplies the rows and the 24h count, so the math is unit-testable
 * without a database.
 */
export function reduceSummary(
  rows: PlanBreakdownRow[],
  newLast24h: number
): SummaryData {
  const byPlan: Record<string, number> = {}
  let totalActive = 0
  let mrrUsd = 0
  for (const row of rows) {
    byPlan[row.plan_id] = (byPlan[row.plan_id] ?? 0) + row.n
    totalActive += row.n
    const plan = BILLING_PLANS[row.plan_id as PlanId]
    mrrUsd += mrrForGroup(plan, row.billing_period, row.n)
  }
  // Round to cents to avoid long floating tails in the message.
  mrrUsd = Math.round(mrrUsd * 100) / 100
  return { totalActive, byPlan, newLast24h, mrrUsd }
}

/** Query D1 for the daily summary. `now` is unix seconds (injectable for tests). */
export async function collectSummary(
  db: D1SummaryDb,
  now: number = Math.floor(Date.now() / 1000)
): Promise<SummaryData> {
  const breakdown = await db
    .prepare(
      `SELECT plan_id, billing_period, COUNT(*) AS n
         FROM user_subscriptions
        WHERE status IN ${ACTIVE_STATUSES}
        GROUP BY plan_id, billing_period`
    )
    .bind()
    .all<PlanBreakdownRow>()

  const since = now - 24 * 60 * 60
  const newRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM user_subscriptions WHERE created_at >= ?1`
    )
    .bind(since)
    .first<{ n: number }>()

  return reduceSummary(breakdown.results ?? [], newRow?.n ?? 0)
}

export function formatSummary(data: SummaryData): string {
  const planLines = Object.entries(data.byPlan)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plan, n]) => `  • ${plan}: ${n}`)
    .join('\n')
  return [
    '\u{1F4CA} <b>chmonitor daily billing summary</b>',
    '',
    `Active subscriptions: <b>${data.totalActive}</b>`,
    planLines || '  (none)',
    '',
    `New in last 24h: <b>${data.newLast24h}</b>`,
    `Estimated MRR: <b>$${data.mrrUsd.toFixed(2)}</b>`,
  ].join('\n')
}
