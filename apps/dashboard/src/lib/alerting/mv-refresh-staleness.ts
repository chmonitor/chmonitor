/**
 * Materialized View Refresh Staleness (#1925)
 *
 * Computes staleness for MV refresh operations from system.view_refreshes.
 * A view is considered failed when exception is non-empty or retry > 0.
 * A failed refresh stays Scheduled, so status labels are not the signal.
 * A view is stale when last_success_time is older than a staleness threshold.
 * An empty exception with no retry stays ok, even if it has never succeeded.
 *
 * Provides SQL to run on ClickHouse and pure helper functions
 * for threshold evaluation and badge rendering.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MvRefreshRow {
  database: string
  view: string
  status: string
  last_success_time: string | null
  last_refresh_time: string | null
  next_refresh_time: string | null
  staleness_seconds: number
  is_failed: number
  exception: string | null
  retry: number
  [key: string]: string | number | null
}

export type MvStalenessLevel = 'ok' | 'stale' | 'failed'

export interface MvStalenessResult {
  database: string
  view: string
  level: MvStalenessLevel
  staleness_seconds: number
  status: string
  exception: string | null
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * SQL to surface stale/failed MV refreshes.
 *
 * Thresholds:
 *   - failed: exception != '' OR retry > 0 → always surfaced
 *   - stale: last_success_time older than staleAfterSeconds
 *   - never succeeded with an empty exception stays out of the failed set
 *
 * The staleAfterSeconds default (3600 = 1 hour) is conservative; operators
 * with longer refresh intervals should increase it via the alert threshold.
 */
export function buildMvStalenessSQL(staleAfterSeconds = 3600): string {
  return `
SELECT
  database,
  view,
  status,
  last_success_time,
  last_refresh_time,
  next_refresh_time,
  dateDiff('second', coalesce(last_success_time, toDateTime(0)), now()) AS staleness_seconds,
  multiIf(
    exception != '' OR retry > 0, 1,
    dateDiff('second', last_success_time, now()) > ${staleAfterSeconds}, 1,
    0
  ) AS is_failed,
  exception,
  retry
FROM system.view_refreshes
ORDER BY is_failed DESC, staleness_seconds DESC
`
}

/**
 * Count SQL — single row result used by the alert rule engine.
 * Returns the number of views that are currently failed or overdue.
 */
export function buildMvFailedCountSQL(staleAfterSeconds = 3600): string {
  return `
SELECT countIf(
  exception != ''
  OR retry > 0
  OR dateDiff('second', last_success_time, now()) > ${staleAfterSeconds}
) AS failed_count
FROM system.view_refreshes
`
}

// ---------------------------------------------------------------------------
// Pure helpers (no ClickHouse dependency — unit-testable)
// ---------------------------------------------------------------------------

/**
 * Classify a single MV refresh row into a staleness level.
 */
export function classifyMvRefresh(
  row: Pick<
    MvRefreshRow,
    'status' | 'staleness_seconds' | 'is_failed' | 'exception' | 'retry'
  >,
  staleAfterSeconds = 3600
): MvStalenessLevel {
  if ((row.exception ?? '') !== '' || (row.retry ?? 0) > 0) return 'failed'
  if (row.is_failed === 1) return 'failed'
  if (row.staleness_seconds > staleAfterSeconds) return 'stale'
  return 'ok'
}

/**
 * Count failed/stale views in a result set.
 * Pure function — used in tests and the alert rule.
 */
export function countMvIssues(rows: MvRefreshRow[]): {
  failed: number
  stale: number
  total: number
} {
  let failed = 0
  let stale = 0
  for (const row of rows) {
    const level = classifyMvRefresh(row)
    if (level === 'failed') failed++
    else if (level === 'stale') stale++
  }
  return { failed, stale, total: rows.length }
}

/**
 * Format a staleness duration for display.
 */
export function formatMvStaleness(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
