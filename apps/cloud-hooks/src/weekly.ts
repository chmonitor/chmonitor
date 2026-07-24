/**
 * Weekly report — the Monday-morning counterpart to the daily digest.
 *
 * The daily digest answers "what happened yesterday". This answers "is the
 * trend up or down", so every headline number is paired with the SAME number
 * from the previous week. A bare "3 new subscriptions" tells the operator
 * nothing; "3 (▲ +1 vs 2)" does.
 *
 * Window: the 7 complete UTC days before the run — i.e. `[start-of-today − 7d,
 * start-of-today)`, with the comparison period the 7 days before that. Anchoring
 * on start-of-today rather than "now" keeps the two periods exactly equal in
 * length, which is what makes the comparison honest.
 *
 * Reuses `queryPlanBreakdown` + `reduceSummary` from summary.ts so the active
 * counts and the MRR estimate are computed identically in both reports.
 */

import type { IssueStats } from './issues'
import type {
  ClerkMetrics,
  D1SummaryDb,
  ProbeSnapshot,
  SummaryData,
} from './summary'
import type { UsageMetrics } from './usage'

import { formatWindowLabel, queryPlanBreakdown, reduceSummary } from './summary'
import { usageLines } from './usage'

const DAY = 24 * 60 * 60
export const WEEK = 7 * DAY

/** A count this period alongside the same count last period. */
export interface Trend {
  current: number
  previous: number
}

export interface WeeklyData {
  /** Inclusive first day of the reported week ('YYYY-MM-DD', UTC). */
  weekStart: string
  /** Inclusive last day of the reported week ('YYYY-MM-DD', UTC). */
  weekEnd: string
  /** Active subscriptions, plan breakdown, and MRR as of now. */
  billing: SummaryData
  newSubscriptions: Trend
  cancellations: Trend
}

export interface WeeklyExtras {
  clerk?: ClerkMetrics | null
  usage?: UsageMetrics | null
  probes?: ProbeSnapshot | null
  issues?: IssueStats | null
}

/** Start of the UTC day containing `now` (unix seconds), as unix seconds. */
export function startOfUtcDay(now: number): number {
  return Math.floor(now / DAY) * DAY
}

function utcDayString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

/**
 * The four boundaries the report needs, all unix seconds:
 * `[prevStart, start)` is last week and `[start, end)` is this week.
 */
export function weekBounds(now: number): {
  prevStart: number
  start: number
  end: number
} {
  const end = startOfUtcDay(now)
  return { end, start: end - WEEK, prevStart: end - 2 * WEEK }
}

/**
 * Render a trend as "current (▲ +delta vs previous)". Flat periods print "flat"
 * rather than "+0", and a first-ever week (no previous data) prints the bare
 * number instead of a meaningless "▲ +3 vs 0".
 */
export function formatTrend(trend: Trend): string {
  const delta = trend.current - trend.previous
  if (trend.previous === 0 && trend.current === 0) return '0'
  if (trend.previous === 0) return `${trend.current}`
  if (delta === 0) return `${trend.current} (flat vs ${trend.previous})`
  const arrow = delta > 0 ? '\u{25B2}' : '\u{25BC}' // ▲ ▼
  const sign = delta > 0 ? '+' : ''
  return `${trend.current} (${arrow} ${sign}${delta} vs ${trend.previous})`
}

/** Count rows in a half-open window on one timestamp column. */
async function countBetween(
  db: D1SummaryDb,
  sql: string,
  from: number,
  to: number
): Promise<number> {
  const row = await db.prepare(sql).bind(from, to).first<{ n: number }>()
  return row?.n ?? 0
}

const NEW_SUBS_SQL = `SELECT COUNT(*) AS n FROM user_subscriptions
   WHERE created_at >= ?1 AND created_at < ?2`
const CANCELS_SQL = `SELECT COUNT(*) AS n FROM user_subscriptions
   WHERE status IN ('canceled','revoked') AND updated_at >= ?1 AND updated_at < ?2`

/** Query D1 for the weekly report. `now` is unix seconds (injectable). */
export async function collectWeekly(
  db: D1SummaryDb,
  now: number = Math.floor(Date.now() / 1000)
): Promise<WeeklyData> {
  const { prevStart, start, end } = weekBounds(now)

  const [rows, newCur, newPrev, cancelCur, cancelPrev] = await Promise.all([
    queryPlanBreakdown(db),
    countBetween(db, NEW_SUBS_SQL, start, end),
    countBetween(db, NEW_SUBS_SQL, prevStart, start),
    countBetween(db, CANCELS_SQL, start, end),
    countBetween(db, CANCELS_SQL, prevStart, start),
  ])

  return {
    weekStart: utcDayString(start),
    // `end` is exclusive (start of today), so the last reported day is end-1s.
    weekEnd: utcDayString(end - 1),
    billing: reduceSummary(rows, newCur),
    newSubscriptions: { current: newCur, previous: newPrev },
    cancellations: { current: cancelCur, previous: cancelPrev },
  }
}

function planLines(byPlan: Record<string, number>): string {
  const lines = Object.entries(byPlan)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plan, n]) => `  • ${plan}: ${n}`)
    .join('\n')
  return lines || '  (none)'
}

/**
 * Compact Telegram-HTML weekly report. Every optional section degrades to
 * omitted, exactly like the daily digest.
 */
export function formatWeekly(
  data: WeeklyData,
  extras: WeeklyExtras = {}
): string {
  const parts: string[] = [
    '\u{1F5D3}\u{FE0F} <b>chmonitor weekly report</b>',
    `<i>${data.weekStart} → ${data.weekEnd}</i>`,
  ]

  if (extras.clerk) {
    parts.push(
      '',
      '\u{1F465} <b>Users</b>',
      `  • Total: ${extras.clerk.totalUsers}`,
      `  • New in ${formatWindowLabel(extras.clerk.windowSeconds)}: ${extras.clerk.newUsers}`
    )
  }

  parts.push(...usageLines(extras.usage))

  parts.push(
    '',
    '\u{1F4B3} <b>Subscriptions</b>',
    `  • Active: ${data.billing.totalActive}`,
    planLines(data.billing.byPlan),
    `  • New this week: ${formatTrend(data.newSubscriptions)}`,
    `  • Cancellations: ${formatTrend(data.cancellations)}`,
    `  • Estimated MRR: <b>$${data.billing.mrrUsd.toFixed(2)}</b>`
  )

  if (extras.issues) {
    parts.push(
      '',
      '\u{1F41E} <b>Issues</b>',
      `  • Opened: ${extras.issues.opened}`,
      `  • Closed: ${extras.issues.closed}`
    )
  }

  if (extras.probes && Object.keys(extras.probes).length > 0) {
    const entries = Object.entries(extras.probes).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    const down = entries.filter(([, s]) => s === 'down')
    parts.push(
      '',
      `\u{1F310} <b>Surfaces</b> — ${
        down.length === 0 ? '\u{2705} all up' : `\u{1F534} ${down.length} down`
      }`,
      entries
        .map(
          ([name, s]) => `  ${s === 'up' ? '\u{1F7E2}' : '\u{1F534}'} ${name}`
        )
        .join('\n')
    )
  }

  return parts.join('\n')
}
