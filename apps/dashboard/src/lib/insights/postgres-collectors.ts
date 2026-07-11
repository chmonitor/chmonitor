/**
 * Deterministic Postgres insight collectors.
 *
 * The Postgres analog of `collectors.ts`. Each collector runs a single
 * read-only query against ONE env-configured Postgres source (`pgHostId`, index
 * into the `POSTGRES_*` lists) through the shared Phase-2 read-only path
 * (`runPostgresReadOnly` → `queryPostgres`, session pinned read-only) and returns
 * candidate insights. Collectors NEVER throw — any query failure (missing view,
 * permission, unreachable host) yields an empty list so the engine degrades
 * gracefully. Classification lives in `./postgres-checks` as pure functions so
 * the thresholds are unit-tested without a live database.
 */

import type { InsightCandidate, InsightSeverity } from './types'

import { runPostgresReadOnly } from '../ai/agent/tools/postgres-helpers'
import {
  checkCacheHitRatio,
  checkConnectionSaturation,
  checkDeadTupleRatio,
  checkIdleInTransaction,
  checkLongRunningQuery,
  checkPgStatStatementsMissing,
  checkReplicationLag,
  checkRollbacksAndDeadlocks,
  checkUnusedIndexes,
} from './postgres-checks'

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : Number(v) || 0
}

/** Run one read-only query, returning its rows or `[]` on any failure. */
async function pgRows<T extends Record<string, unknown>>(
  pgHostId: number,
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<T[]> {
  try {
    const { rows } = await runPostgresReadOnly<T>(pgHostId, sql, params)
    return rows
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Connections + activity (pg_stat_activity + pg_settings).
// ---------------------------------------------------------------------------

/**
 * Connection saturation, longest active query, and longest idle-in-transaction
 * in ONE round-trip. `max_connections` comes from pg_settings (the collector
 * analog of the agent tool's saturation reading).
 */
const ACTIVITY_SQL = `SELECT
  (SELECT count(*) FROM pg_stat_activity) AS active_connections,
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
  coalesce((
    SELECT max(extract(epoch FROM (now() - query_start)))
    FROM pg_stat_activity
    WHERE state = 'active' AND query_start IS NOT NULL
  ), 0) AS longest_active_seconds,
  coalesce((
    SELECT max(extract(epoch FROM (now() - xact_start)))
    FROM pg_stat_activity
    WHERE state = 'idle in transaction' AND xact_start IS NOT NULL
  ), 0) AS longest_idle_txn_seconds,
  (
    SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'
  ) AS idle_txn_count`

async function collectActivity(pgHostId: number): Promise<InsightCandidate[]> {
  const out: InsightCandidate[] = []
  const rows = await pgRows<Record<string, unknown>>(pgHostId, ACTIVITY_SQL)
  const r = rows[0]
  if (!r) return out

  const saturation = checkConnectionSaturation(
    toNum(r.active_connections),
    toNum(r.max_connections)
  )
  if (saturation) out.push(saturation)

  const longRunning = checkLongRunningQuery(toNum(r.longest_active_seconds))
  if (longRunning) out.push(longRunning)

  const idle = checkIdleInTransaction(
    toNum(r.longest_idle_txn_seconds),
    toNum(r.idle_txn_count)
  )
  if (idle) out.push(idle)

  return out
}

// ---------------------------------------------------------------------------
// Database-wide stats (pg_stat_database): cache hit ratio, rollbacks/deadlocks,
// replication lag.
// ---------------------------------------------------------------------------

const DATABASE_SQL = `SELECT
  coalesce(sum(blks_hit), 0)::bigint AS blks_hit,
  coalesce(sum(blks_read), 0)::bigint AS blks_read,
  coalesce(sum(xact_commit), 0)::bigint AS xact_commit,
  coalesce(sum(xact_rollback), 0)::bigint AS xact_rollback,
  coalesce(sum(deadlocks), 0)::bigint AS deadlocks,
  CASE
    WHEN pg_is_in_recovery()
    THEN extract(epoch FROM (now() - pg_last_xact_replay_timestamp()))
    ELSE NULL
  END AS replica_lag_seconds
FROM pg_stat_database`

async function collectDatabase(pgHostId: number): Promise<InsightCandidate[]> {
  const out: InsightCandidate[] = []
  const rows = await pgRows<Record<string, unknown>>(pgHostId, DATABASE_SQL)
  const r = rows[0]
  if (!r) return out

  const cache = checkCacheHitRatio(toNum(r.blks_hit), toNum(r.blks_read))
  if (cache) out.push(cache)

  const rollbacks = checkRollbacksAndDeadlocks(
    toNum(r.xact_commit),
    toNum(r.xact_rollback),
    toNum(r.deadlocks)
  )
  if (rollbacks) out.push(rollbacks)

  if (r.replica_lag_seconds !== null && r.replica_lag_seconds !== undefined) {
    const lag = checkReplicationLag(toNum(r.replica_lag_seconds))
    if (lag) out.push(lag)
  }

  return out
}

// ---------------------------------------------------------------------------
// Table-level bloat (pg_stat_user_tables) — worst dead-tuple ratio.
// ---------------------------------------------------------------------------

const DEAD_TUPLES_SQL = `SELECT
  (schemaname || '.' || relname) AS table_name,
  n_dead_tup,
  n_live_tup
FROM pg_stat_user_tables
WHERE n_live_tup > 1000
ORDER BY n_dead_tup::float / nullif(n_live_tup, 0) DESC
LIMIT 1`

async function collectDeadTuples(
  pgHostId: number
): Promise<InsightCandidate[]> {
  const rows = await pgRows<Record<string, unknown>>(pgHostId, DEAD_TUPLES_SQL)
  const r = rows[0]
  if (!r) return []
  const candidate = checkDeadTupleRatio(
    toNum(r.n_dead_tup),
    toNum(r.n_live_tup),
    String(r.table_name ?? '')
  )
  return candidate ? [candidate] : []
}

// ---------------------------------------------------------------------------
// Unused indexes (pg_stat_user_indexes) — idx_scan = 0, excluding PK / unique
// constraint indexes (those are integrity-backing, not tuning candidates).
// ---------------------------------------------------------------------------

const UNUSED_INDEXES_SQL = `SELECT (s.schemaname || '.' || s.indexrelname) AS index_name
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique
  AND NOT i.indisprimary
  AND pg_relation_size(s.indexrelid) > 1048576
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 20`

async function collectUnusedIndexes(
  pgHostId: number
): Promise<InsightCandidate[]> {
  const rows = await pgRows<{ index_name: string }>(
    pgHostId,
    UNUSED_INDEXES_SQL
  )
  const names = rows
    .map((r) => r.index_name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
  const candidate = checkUnusedIndexes(names.length, names)
  return candidate ? [candidate] : []
}

// ---------------------------------------------------------------------------
// pg_stat_statements availability.
// ---------------------------------------------------------------------------

async function collectStatStatements(
  pgHostId: number
): Promise<InsightCandidate[]> {
  const rows = await pgRows<{ present: number }>(
    pgHostId,
    "SELECT count(*)::int AS present FROM pg_extension WHERE extname = 'pg_stat_statements'"
  )
  // Only surface the "enable it" nudge when we could actually read pg_extension
  // (rows present). A failed probe yields [] and stays silent.
  if (rows.length === 0) return []
  const candidate = checkPgStatStatementsMissing(toNum(rows[0]?.present))
  return candidate ? [candidate] : []
}

/**
 * Run all Postgres collectors for one source and return de-duplicated
 * candidates, highest severity first. Mirrors `collectInsights` for ClickHouse.
 */
export async function collectPostgresInsights(
  pgHostId: number
): Promise<InsightCandidate[]> {
  const groups = await Promise.all([
    collectActivity(pgHostId).catch(() => []),
    collectDatabase(pgHostId).catch(() => []),
    collectDeadTuples(pgHostId).catch(() => []),
    collectUnusedIndexes(pgHostId).catch(() => []),
    collectStatStatements(pgHostId).catch(() => []),
  ])

  const seen = new Set<string>()
  const merged: InsightCandidate[] = []
  for (const candidate of groups.flat()) {
    const dedupeKey = `${candidate.category}:${candidate.metric ?? candidate.title}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    merged.push(candidate)
  }

  const rank: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  return merged.sort((a, b) => rank[a.severity] - rank[b.severity])
}
