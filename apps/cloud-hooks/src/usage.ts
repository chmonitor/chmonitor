/**
 * Usage metrics (DAU / WAU / MAU) read from the telemetry D1 (`chm_telemetry`,
 * bound as CHM_TELEMETRY_DB — the same database apps/telemetry writes).
 *
 * IMPORTANT — what these numbers mean. The telemetry store is deliberately
 * anonymous: `ping_daily` holds one deduped row per (UTC day, opaque install
 * hash) and `cli_daily` one per (day, install, event, command). There is no
 * user identity in either table, so these are **active installs**, NOT active
 * humans, and every label in the digest says "installs" for that reason. Clerk
 * account counts (clerk-metrics.ts) remain the user-level figure.
 *
 * Windows end on the last COMPLETE UTC day. The daily digest fires at 00:00 UTC
 * when "today" has barely started; counting it would report a near-zero DAU
 * every morning. So `referenceDay` is yesterday and every window is measured
 * back from it.
 *
 * Best-effort like the rest of the worker: an unbound database, a missing
 * table, or a query error logs one line and returns null, and the digest simply
 * omits the Usage section.
 */

import { logError as emitLogError, logInfo } from './log'

/** Minimal D1 subset used here (mirrors `D1SummaryDb` in summary.ts). */
export interface D1UsageDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>
    }
  }
}

/** DAU/WAU/MAU for one telemetry stream. */
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
  /** Dashboard installs (`ping_daily`). */
  dashboard: ActiveCounts
  /** CLI installs (`cli_daily`), excluding install-only rows. */
  cli: ActiveCounts
  /** New CLI installs recorded on the reference day (`event = 'cli_install'`). */
  cliInstalls24h: number
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

interface WindowRow {
  dau: number | null
  wau: number | null
  mau: number | null
}

/**
 * One pass over a day-partitioned table yields all three windows: SQLite counts
 * distinct ids per window with a CASE inside COUNT(DISTINCT …), so we scan the
 * 30-day range once instead of issuing three separate queries.
 *
 * `idColumn` and `table` are interpolated, never user input — they are the two
 * literals below. `extraWhere` is likewise a fixed fragment.
 */
async function countWindows(
  db: D1UsageDb,
  table: string,
  idColumn: string,
  referenceDay: string,
  extraWhere = ''
): Promise<ActiveCounts | null> {
  const weekStart = shiftDay(referenceDay, -6)
  const monthStart = shiftDay(referenceDay, -29)
  const row = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN day = ?1 THEN ${idColumn} END) AS dau,
         COUNT(DISTINCT CASE WHEN day >= ?2 THEN ${idColumn} END) AS wau,
         COUNT(DISTINCT ${idColumn}) AS mau
       FROM ${table}
      WHERE day >= ?3 AND day <= ?1${extraWhere}`
    )
    .bind(referenceDay, weekStart, monthStart)
    .first<WindowRow>()
  if (!row) return null
  return { dau: row.dau ?? 0, wau: row.wau ?? 0, mau: row.mau ?? 0 }
}

/**
 * Run one query, converting any failure into null. Each stream is isolated on
 * purpose: `cli_daily` is a newer table than `ping_daily`, so a database that
 * is mid-migration should still report the stream that does exist instead of
 * dropping the whole Usage section. It also keeps a failure from surfacing as
 * an unhandled rejection when several queries are in flight together.
 */
async function safeQuery<T>(
  run: () => Promise<T | null>,
  label: string,
  logError: (message: string, meta?: unknown) => void
): Promise<T | null> {
  try {
    return await run()
  } catch (err) {
    logError(`[cloud-hooks] usage query failed (${label})`, err)
    return null
  }
}

/**
 * Collect DAU/WAU/MAU for both telemetry streams. `now` is unix seconds
 * (injectable for tests). Returns null when the database is unbound or every
 * stream query fails; a single failing stream degrades to zeroes.
 */
export async function collectUsage(
  db: D1UsageDb | null | undefined,
  now: number = Math.floor(Date.now() / 1000),
  onLogError: (message: string, meta?: unknown) => void = emitLogError
): Promise<UsageMetrics | null> {
  if (!db) {
    logInfo('[cloud-hooks] CHM_TELEMETRY_DB unbound; digest omits usage')
    return null
  }
  // Yesterday — the last complete UTC day (see the module header).
  const referenceDay = utcDay(new Date((now - 24 * 60 * 60) * 1000))

  const [dashboard, cli, installRow] = await Promise.all([
    safeQuery(
      () => countWindows(db, 'ping_daily', 'instance_hash', referenceDay),
      'ping_daily',
      onLogError
    ),
    // `cli_install` rows can carry an ephemeral id (see migration 0005), so
    // they would inflate a distinct-install count. Active CLI usage is the
    // run/diagnose events only.
    safeQuery(
      () =>
        countWindows(
          db,
          'cli_daily',
          'install_id',
          referenceDay,
          " AND event <> 'cli_install'"
        ),
      'cli_daily',
      onLogError
    ),
    safeQuery(
      () =>
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM cli_daily
              WHERE day = ?1 AND event = 'cli_install'`
          )
          .bind(referenceDay)
          .first<{ n: number }>(),
      'cli_installs',
      onLogError
    ),
  ])

  if (!dashboard && !cli) return null
  return {
    referenceDay,
    dashboard: dashboard ?? { dau: 0, wau: 0, mau: 0 },
    cli: cli ?? { dau: 0, wau: 0, mau: 0 },
    cliInstalls24h: installRow?.n ?? 0,
  }
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
    formatActiveLine('Dashboard', usage.dashboard),
    formatActiveLine('CLI', usage.cli),
  ]
  if (usage.cliInstalls24h > 0) {
    lines.push(`  • New CLI installs: ${usage.cliInstalls24h}`)
  }
  return lines
}
