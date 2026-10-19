/**
 * Usage metrics (DAU / WAU / MAU) read from the shared telemetry service's
 * public stats API (project `chmonitor`).
 *
 * IMPORTANT — what these numbers mean. Telemetry is deliberately anonymous: the
 * service counts distinct hashed install ids, with no user identity. These are
 * **active installs**, NOT active humans, and every label in the digest says
 * "installs" for that reason. Clerk account counts (clerk-metrics.ts) remain
 * the user-level figure. The dashboard and the CLI report into the same
 * project with separate id spaces, so the figure is dashboard + CLI installs
 * combined; the API has no per-day split by event.
 *
 * Windows end on the last COMPLETE UTC day. The service's `summary` describes
 * yesterday and is zero until its daily rollup (00:10 UTC) has written that
 * day, so the daily digest runs after the rollup (see `isDailyTick` in
 * index.ts). `referenceDay` is yesterday and every window is measured back
 * from it.
 *
 * Best-effort like the rest of the worker: an unreachable API, a bad response,
 * or a response that lacks the reference day logs one line and returns null,
 * and the digest simply omits the Usage section.
 */

import { logError as emitLogError } from './log'

/** Public stats endpoint of the shared telemetry service, project `chmonitor`. */
export const TELEMETRY_STATS_URL =
  'https://telemetry.anyr.workers.dev/api/chmonitor/stats'

/** `?days=` — the service accepts 7|30|90|365. 30 covers the anomaly baseline. */
const STATS_DAYS = 30
const FETCH_TIMEOUT_MS = 5_000

/** The part of the stats API response this worker reads. */
export interface TelemetryStats {
  /** For the latest closed day (yesterday); zero until the rollup has run. */
  summary: { dau: number; wau: number; mau: number }
  /** One entry per day for `STATS_DAYS`, ending yesterday, zero-filled. */
  series: Array<{ day: string; dau: number }>
}

/** DAU/WAU/MAU for the telemetry stream. */
export interface ActiveCounts {
  /** Distinct installs active on the reference day. */
  dau: number
  /** Distinct installs active in the 7 days ending on the reference day. */
  wau: number
  /** Distinct installs active in the 30 days ending on the reference day. */
  mau: number
}

export interface UsageMetrics {
  /** Last complete UTC day the windows are measured back from ('YYYY-MM-DD'). */
  referenceDay: string
  /** Active installs (dashboard + CLI) as of the reference day. */
  active: ActiveCounts
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Format a Date as a UTC 'YYYY-MM-DD' day key, matching the telemetry schema. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Shift a 'YYYY-MM-DD' day key by `days` (negative = earlier). */
export function shiftDay(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS))
}

/**
 * Stickiness — DAU as a percentage of MAU, the standard "how many of this
 * month's installs showed up today" ratio. Returns null when MAU is 0 so the
 * digest can omit it rather than print a meaningless 0%.
 */
export function stickiness(counts: ActiveCounts): number | null {
  if (counts.mau <= 0) return null
  return Math.round((counts.dau / counts.mau) * 1000) / 10
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** Narrow the parsed JSON to the fields we use; null when any is missing. */
function parseStats(json: unknown): TelemetryStats | null {
  if (typeof json !== 'object' || json === null) return null
  const { summary, series } = json as {
    summary?: Record<string, unknown>
    series?: unknown
  }
  if (!summary || !isCount(summary.dau) || !isCount(summary.wau)) return null
  if (!isCount(summary.mau) || !Array.isArray(series)) return null
  const days: TelemetryStats['series'] = []
  for (const row of series) {
    if (typeof row?.day !== 'string' || !isCount(row?.dau)) return null
    days.push({ day: row.day, dau: row.dau })
  }
  return {
    summary: { dau: summary.dau, wau: summary.wau, mau: summary.mau },
    series: days,
  }
}

/**
 * Fetch the stats once. Never rejects: any failure is logged once and becomes
 * null, so callers can start it early and await it from several places.
 *
 * The logger is a parameter so callers can capture it, and the default is
 * aliased through `emitLogError` on purpose: a parameter named `logError` would
 * shadow the import inside this very signature, so a default body calling
 * `logError` would call itself. Because that self-call sits in tail position,
 * JSC turns it into a loop rather than a stack overflow — it never throws and
 * never returns, so it burns CPU until the platform kills the Worker. Keep both
 * names.
 */
export async function fetchUsageStats(
  fetchImpl: typeof fetch = fetch,
  log: (message: string, meta?: unknown) => void = (m, meta) =>
    emitLogError(m, meta),
  url: string = TELEMETRY_STATS_URL
): Promise<TelemetryStats | null> {
  try {
    const res = await fetchImpl(`${url}?days=${STATS_DAYS}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      log(`[cloud-hooks] telemetry stats returned HTTP ${res.status}`)
      return null
    }
    const stats = parseStats(await res.json())
    if (!stats) {
      log('[cloud-hooks] telemetry stats response has an unexpected shape')
      return null
    }
    return stats
  } catch (err) {
    log('[cloud-hooks] telemetry stats fetch failed', err)
    return null
  }
}

/** Yesterday (the last complete UTC day) for `now` in unix seconds. */
export function referenceDayFor(now: number): string {
  return utcDay(new Date((now - 24 * 60 * 60) * 1000))
}

/**
 * Whether the stats series actually contains the reference day. A missing row
 * is a stale rollup, not a collapse to zero: detectAnomaly would otherwise
 * read current = 0 over a full baseline and fire a false -100% drop.
 */
export function statsCoverReferenceDay(
  stats: TelemetryStats,
  referenceDay: string
): boolean {
  return stats.series.some((row) => row.day === referenceDay)
}

/**
 * Active-install counts as of yesterday. `now` is unix seconds (injectable for
 * tests). Returns null when there are no stats or they do not cover the
 * reference day — better to omit the section than report another day's numbers
 * under yesterday's date.
 */
export function collectUsage(
  stats: TelemetryStats | null | undefined,
  now: number = Math.floor(Date.now() / 1000),
  onLogError: (message: string, meta?: unknown) => void = (m, meta) =>
    emitLogError(m, meta)
): UsageMetrics | null {
  if (!stats) return null
  const referenceDay = referenceDayFor(now)
  if (!statsCoverReferenceDay(stats, referenceDay)) {
    onLogError(
      `[cloud-hooks] telemetry stats do not cover ${referenceDay}; digest omits usage`
    )
    return null
  }
  const { dau, wau, mau } = stats.summary
  return { referenceDay, active: { dau, wau, mau } }
}

/** One "DAU x · WAU y · MAU z (stickiness s%)" line for a stream. */
export function formatActiveLine(label: string, counts: ActiveCounts): string {
  const stick = stickiness(counts)
  const tail = stick === null ? '' : ` · stickiness ${stick}%`
  return `  • ${label}: DAU ${counts.dau} · WAU ${counts.wau} · MAU ${counts.mau}${tail}`
}

/**
 * The Usage block of a digest. Returns [] when there is nothing to report so
 * the caller can spread it into the message unconditionally.
 */
export function usageLines(usage: UsageMetrics | null | undefined): string[] {
  if (!usage) return []
  const lines = [
    '',
    `\u{1F4C8} <b>Usage</b> <i>(installs, ${usage.referenceDay})</i>`,
    formatActiveLine('Dashboard + CLI', usage.active),
  ]
  return lines
}
