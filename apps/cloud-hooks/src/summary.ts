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
  /** New subscriptions in the last 24h, grouped by plan id. */
  newByPlan: Record<string, number>
  /** Subscriptions cancelled/revoked in the last 24h. */
  cancellations24h: number
  /** Estimated monthly recurring revenue in USD. */
  mrrUsd: number
}

/** Optional Clerk user metrics (omitted from the digest when unavailable). */
export interface ClerkMetrics {
  totalUsers: number
  newUsers24h: number
}

/** Optional per-surface probe snapshot (last-known up/down state). */
export type ProbeSnapshot = Record<string, 'up' | 'down'>

export interface DigestExtras {
  clerk?: ClerkMetrics | null
  probes?: ProbeSnapshot | null
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
  newLast24h: number,
  extras: {
    newByPlan?: Record<string, number>
    cancellations24h?: number
  } = {}
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
  return {
    totalActive,
    byPlan,
    newLast24h,
    newByPlan: extras.newByPlan ?? {},
    cancellations24h: extras.cancellations24h ?? 0,
    mrrUsd,
  }
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

  const newByPlanRows = await db
    .prepare(
      `SELECT plan_id, COUNT(*) AS n
         FROM user_subscriptions
        WHERE created_at >= ?1
        GROUP BY plan_id`
    )
    .bind(since)
    .all<{ plan_id: string; n: number }>()

  const cancelRow = await db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM user_subscriptions
        WHERE status IN ('canceled','revoked') AND updated_at >= ?1`
    )
    .bind(since)
    .first<{ n: number }>()

  const newByPlan: Record<string, number> = {}
  for (const row of newByPlanRows.results ?? []) {
    newByPlan[row.plan_id] = (newByPlan[row.plan_id] ?? 0) + row.n
  }

  return reduceSummary(breakdown.results ?? [], newRow?.n ?? 0, {
    newByPlan,
    cancellations24h: cancelRow?.n ?? 0,
  })
}

function planBreakdownLines(byPlan: Record<string, number>): string {
  const lines = Object.entries(byPlan)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plan, n]) => `  • ${plan}: ${n}`)
    .join('\n')
  return lines || '  (none)'
}

/**
 * Compact Telegram-HTML digest. Sections degrade gracefully: the Users section
 * is omitted when Clerk metrics are unavailable (missing key), and the Surfaces
 * section is omitted when no probe snapshot is present.
 */
export function formatDigest(
  data: SummaryData,
  extras: DigestExtras = {}
): string {
  const parts: string[] = ['\u{1F4CA} <b>chmonitor daily digest</b>']

  // ── Users (Clerk) — only when metrics are available ─────────────────────────
  if (extras.clerk) {
    parts.push(
      '',
      '\u{1F465} <b>Users</b>',
      `  • Total: ${extras.clerk.totalUsers}`,
      `  • New in 24h: ${extras.clerk.newUsers24h}`
    )
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────
  parts.push(
    '',
    '\u{1F4B3} <b>Subscriptions</b>',
    `  • Active: ${data.totalActive}`,
    planBreakdownLines(data.byPlan)
  )

  const newByPlanLine =
    Object.keys(data.newByPlan).length > 0
      ? Object.entries(data.newByPlan)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([plan, n]) => `${plan}:${n}`)
          .join(', ')
      : 'none'
  parts.push(
    `  • New in 24h: ${data.newLast24h} (${newByPlanLine})`,
    `  • Cancellations in 24h: ${data.cancellations24h}`,
    `  • Estimated MRR: <b>$${data.mrrUsd.toFixed(2)}</b>`
  )

  // ── Surfaces (probe snapshot) — only when a snapshot exists ─────────────────
  if (extras.probes && Object.keys(extras.probes).length > 0) {
    const entries = Object.entries(extras.probes).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    const down = entries.filter(([, s]) => s === 'down')
    const header =
      down.length === 0
        ? '\u{2705} all up' // ✅
        : `\u{1F534} ${down.length} down` // 🔴
    parts.push(
      '',
      `\u{1F310} <b>Surfaces</b> — ${header}`,
      entries
        .map(
          ([name, s]) => `  ${s === 'up' ? '\u{1F7E2}' : '\u{1F534}'} ${name}`
        )
        .join('\n')
    )
  }

  return parts.join('\n')
}

/** Back-compat alias: the billing-only summary is the digest with no extras. */
export function formatSummary(data: SummaryData): string {
  return formatDigest(data)
}
