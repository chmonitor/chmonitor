/**
 * Pure classifiers for the Postgres insight collectors.
 *
 * The Postgres analog of `operational-checks.ts`: each function maps a raw
 * metric (already extracted from a `pg_stat_*` / `pg_settings` read) to an
 * `InsightCandidate` or `null` when the reading is not worth surfacing. They are
 * deliberately pure (no Postgres / store I/O) so they can be unit-tested against
 * boundary values. `postgres-collectors.ts` owns the SQL and calls these;
 * thresholds live here as named constants so tests and collectors share one
 * source of truth.
 *
 * Category reuse: Postgres findings intentionally reuse the existing insight
 * categories (`performance` / `reliability` / `storage` / `optimization`) rather
 * than inventing new ones, so the board's `CATEGORY_META` and filters work
 * unchanged. Metric names are `pg_`-prefixed so they never collide with a
 * ClickHouse metric, and titles carry a "Postgres:" prefix so a finding reads
 * unambiguously wherever it surfaces.
 */

import type { InsightCandidate } from './types'

/** Connection saturation (active / max_connections): warn/critical thresholds. */
export const PG_CONN_SATURATION_WARN_PCT = 80
export const PG_CONN_SATURATION_CRIT_PCT = 90

/** Buffer-cache hit ratio: below these percentages we warn / escalate. */
export const PG_CACHE_HIT_WARN_PCT = 90
export const PG_CACHE_HIT_CRIT_PCT = 80
/**
 * Minimum total buffer accesses (hit+read) before the cache-hit ratio is
 * meaningful. A freshly started server has a tiny, noisy denominator whose ratio
 * says nothing about steady-state cache health — skip it below this floor.
 */
export const PG_CACHE_MIN_TOTAL_BLOCKS = 100_000

/** Idle-in-transaction age (seconds): warn / critical. */
export const PG_IDLE_IN_TXN_WARN_SECONDS = 300
export const PG_IDLE_IN_TXN_CRIT_SECONDS = 900

/** A live query must run at least this long (seconds) before we surface it. */
export const PG_LONG_QUERY_INFO_SECONDS = 60
/** At/above this runtime (seconds) the long-running query escalates to warning. */
export const PG_LONG_QUERY_WARN_SECONDS = 300

/** Dead-tuple ratio (dead / live) above which a table needs vacuum attention. */
export const PG_DEAD_TUPLE_WARN_RATIO = 0.2

/** Replication lag (seconds): warn / critical. */
export const PG_REPLICATION_LAG_WARN_SECONDS = 60
export const PG_REPLICATION_LAG_CRIT_SECONDS = 600

/** Transaction rollback ratio (rollback / (commit+rollback)) warn threshold. */
export const PG_ROLLBACK_WARN_RATIO = 0.1
/** Minimum total transactions before the rollback ratio is meaningful. */
export const PG_ROLLBACK_MIN_TOTAL_XACTS = 1_000

const round = (n: number) => Math.round(n * 100) / 100

/** Render a duration in seconds as a compact human string (`45s` / `12m` / `1.5h`). */
function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.round((seconds / 3600) * 10) / 10}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds)}s`
}

/**
 * Connection saturation — active backends as a fraction of `max_connections`.
 * Nearing the limit risks "too many clients" errors that lock everyone out, so
 * this is a leading indicator worth surfacing before it bites.
 */
export function checkConnectionSaturation(
  active: number,
  maxConnections: number
): InsightCandidate | null {
  if (
    !Number.isFinite(active) ||
    !Number.isFinite(maxConnections) ||
    maxConnections <= 0
  )
    return null
  const pct = (active / maxConnections) * 100
  if (pct < PG_CONN_SATURATION_WARN_PCT) return null
  return {
    severity: pct >= PG_CONN_SATURATION_CRIT_PCT ? 'critical' : 'warning',
    category: 'performance',
    metric: 'pg_connection_saturation',
    title: 'Postgres: connection pool near capacity',
    detail: `${active} of ${maxConnections} connections are in use (${round(pct)}%). Approaching max_connections risks "too many clients already" errors — add a pooler (PgBouncer), lower client pool sizes, or raise max_connections.`,
    value: round(pct),
    action: { label: 'View activity', href: '/postgres/activity' },
  }
}

/**
 * Buffer-cache hit ratio — `blks_hit / (blks_hit + blks_read)`. A low ratio
 * means the working set does not fit in shared_buffers / OS cache, so reads hit
 * disk. Skipped entirely on a cold server (tiny denominator).
 */
export function checkCacheHitRatio(
  blksHit: number,
  blksRead: number
): InsightCandidate | null {
  if (!Number.isFinite(blksHit) || !Number.isFinite(blksRead)) return null
  const total = blksHit + blksRead
  if (total < PG_CACHE_MIN_TOTAL_BLOCKS) return null
  const pct = (blksHit / total) * 100
  if (pct >= PG_CACHE_HIT_WARN_PCT) return null
  return {
    severity: pct < PG_CACHE_HIT_CRIT_PCT ? 'critical' : 'warning',
    category: 'performance',
    metric: 'pg_cache_hit_ratio',
    title: 'Postgres: low buffer-cache hit ratio',
    detail: `The buffer-cache hit ratio is ${round(pct)}% — a large share of reads are hitting disk instead of shared_buffers. Consider raising shared_buffers, adding memory, or adding indexes so hot queries scan less data.`,
    value: round(pct),
    action: { label: 'Investigate', href: '/postgres/queries' },
  }
}

/**
 * Idle-in-transaction — a backend that opened a transaction and stopped. It
 * holds locks and pins the xmin horizon (blocking vacuum / bloating tables), so
 * a long one is a real problem. `count` is how many such backends exist.
 */
export function checkIdleInTransaction(
  maxIdleSeconds: number,
  count: number
): InsightCandidate | null {
  if (
    !Number.isFinite(maxIdleSeconds) ||
    maxIdleSeconds < PG_IDLE_IN_TXN_WARN_SECONDS
  )
    return null
  const others = Number.isFinite(count) && count > 1 ? count : 0
  return {
    severity:
      maxIdleSeconds >= PG_IDLE_IN_TXN_CRIT_SECONDS ? 'critical' : 'warning',
    category: 'reliability',
    metric: 'pg_idle_in_transaction',
    title: `Postgres: transaction idle for ${formatDuration(maxIdleSeconds)}`,
    detail: `A backend has sat idle in a transaction for ${formatDuration(maxIdleSeconds)}${others ? ` (${others} idle-in-transaction backends)` : ''}. These hold locks and pin the xmin horizon, blocking autovacuum and bloating tables — commit/rollback the session or set idle_in_transaction_session_timeout.`,
    value: Math.round(maxIdleSeconds),
    action: { label: 'View activity', href: '/postgres/activity' },
  }
}

/**
 * Longest active (non-idle) query. A single very long-running query holds locks
 * and memory and often signals a missing index or filter.
 */
export function checkLongRunningQuery(
  maxActiveSeconds: number
): InsightCandidate | null {
  if (
    !Number.isFinite(maxActiveSeconds) ||
    maxActiveSeconds < PG_LONG_QUERY_INFO_SECONDS
  )
    return null
  return {
    severity:
      maxActiveSeconds >= PG_LONG_QUERY_WARN_SECONDS ? 'warning' : 'info',
    category: 'performance',
    metric: 'pg_long_running_query',
    title: `Postgres: a query has run for ${formatDuration(maxActiveSeconds)}`,
    detail: `The longest active query has been running for ${formatDuration(maxActiveSeconds)}. Long queries hold locks and memory — check pg_stat_activity for a runaway scan or a missing index/filter, and cancel it if it is stuck.`,
    value: Math.round(maxActiveSeconds),
    action: { label: 'View activity', href: '/postgres/activity' },
  }
}

/**
 * `pg_stat_statements` availability. Without it, normalized slow-query analysis
 * is impossible — an informational nudge to enable the extension. `present` is
 * the `pg_extension` row count (0 = not installed).
 */
export function checkPgStatStatementsMissing(
  present: number
): InsightCandidate | null {
  if (Number.isFinite(present) && present > 0) return null
  return {
    severity: 'info',
    category: 'performance',
    metric: 'pg_stat_statements_missing',
    title: 'Postgres: enable pg_stat_statements',
    detail: `The pg_stat_statements extension is not installed, so normalized slow-query patterns are unavailable. Add it (shared_preload_libraries = 'pg_stat_statements' + CREATE EXTENSION pg_stat_statements) to unlock query performance analysis.`,
    value: 0,
    action: { label: 'View queries', href: '/postgres/queries' },
  }
}

/**
 * Dead-tuple ratio for the worst table — `n_dead_tup / n_live_tup`. A high ratio
 * means autovacuum is falling behind, which bloats the table and slows scans.
 */
export function checkDeadTupleRatio(
  deadTup: number,
  liveTup: number,
  worstTable: string
): InsightCandidate | null {
  if (!Number.isFinite(deadTup) || !Number.isFinite(liveTup) || liveTup <= 0)
    return null
  const ratio = deadTup / liveTup
  if (ratio < PG_DEAD_TUPLE_WARN_RATIO) return null
  const table = worstTable || 'a table'
  return {
    severity: 'warning',
    category: 'storage',
    metric: 'pg_dead_tuple_ratio',
    title: `Postgres: ${table} has high dead-tuple bloat`,
    detail: `${table} has ${deadTup.toLocaleString()} dead tuples vs ${liveTup.toLocaleString()} live (${Math.round(ratio * 100)}%). Autovacuum is falling behind — run VACUUM (ANALYZE), or tune autovacuum_vacuum_scale_factor for this table.`,
    value: round(ratio),
    action: { label: 'View activity', href: '/postgres/activity' },
  }
}

/**
 * Unused indexes — indexes with `idx_scan = 0` (never used for a scan) still
 * cost write amplification and disk. `names` is the pre-filtered list (PK /
 * unique constraints already excluded by the collector's SQL).
 */
export function checkUnusedIndexes(
  count: number,
  names: readonly string[]
): InsightCandidate | null {
  if (!Number.isFinite(count) || count < 1 || names.length === 0) return null
  const shown = names.slice(0, 3).join(', ')
  const more = names.length > 3 ? `, +${names.length - 3} more` : ''
  return {
    severity: 'info',
    category: 'optimization',
    metric: 'pg_unused_indexes',
    title: `Postgres: ${count} unused index${count > 1 ? 'es' : ''}`,
    detail: `${count} non-constraint index${count > 1 ? 'es have' : ' has'} never been used for a scan (${shown}${more}). They add write and storage overhead with no read benefit — review and DROP the ones you have confirmed are safe.`,
    value: count,
    action: { label: 'View queries', href: '/postgres/queries' },
  }
}

/**
 * Replication lag on a standby, in seconds. Reuses the standby-lag reading from
 * `get_postgres_metrics`. Sustained lag risks stale reads and a growing WAL
 * backlog on the primary.
 */
export function checkReplicationLag(
  lagSeconds: number
): InsightCandidate | null {
  if (
    !Number.isFinite(lagSeconds) ||
    lagSeconds < PG_REPLICATION_LAG_WARN_SECONDS
  )
    return null
  return {
    severity:
      lagSeconds >= PG_REPLICATION_LAG_CRIT_SECONDS ? 'critical' : 'warning',
    category: 'reliability',
    metric: 'pg_replication_lag',
    title: 'Postgres: replication is lagging',
    detail: `This standby is ${Math.round(lagSeconds)}s behind the primary. Sustained lag risks stale reads and a growing WAL backlog — check network throughput, standby disk I/O, and long-running queries holding back replay.`,
    value: Math.round(lagSeconds),
    action: { label: 'View activity', href: '/postgres/activity' },
  }
}

/**
 * Transaction rollback ratio + deadlocks. A high rollback share or any
 * deadlocks point at application-level contention worth investigating.
 */
export function checkRollbacksAndDeadlocks(
  xactCommit: number,
  xactRollback: number,
  deadlocks: number
): InsightCandidate | null {
  const commit = Number.isFinite(xactCommit) ? xactCommit : 0
  const rollback = Number.isFinite(xactRollback) ? xactRollback : 0
  const dl = Number.isFinite(deadlocks) ? deadlocks : 0
  const total = commit + rollback
  const ratio = total > 0 ? rollback / total : 0

  const highRollback =
    total >= PG_ROLLBACK_MIN_TOTAL_XACTS && ratio >= PG_ROLLBACK_WARN_RATIO
  if (!highRollback && dl <= 0) return null

  const parts: string[] = []
  if (highRollback)
    parts.push(
      `${Math.round(ratio * 100)}% of transactions rolled back (${rollback.toLocaleString()} of ${total.toLocaleString()})`
    )
  if (dl > 0)
    parts.push(`${dl.toLocaleString()} deadlock${dl > 1 ? 's' : ''} recorded`)

  return {
    severity: 'warning',
    category: 'reliability',
    metric: 'pg_rollbacks_deadlocks',
    title: 'Postgres: elevated rollbacks / deadlocks',
    detail: `${parts.join('; ')}. This usually reflects application-level contention or error handling — inspect failing transactions and lock-ordering in the app.`,
    value: dl > 0 ? dl : round(ratio),
    action: { label: 'View activity', href: '/postgres/activity' },
  }
}
