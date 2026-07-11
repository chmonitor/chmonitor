/**
 * Postgres health tool for the agent (cross-source, env-gated).
 *
 * `get_postgres_metrics` is the Postgres analog of ClickHouse `get_metrics`:
 * version/uptime, connection counts by state, buffer-cache hit ratio,
 * transaction commit/rollback + deadlocks, database size, and replication
 * status (lag on a replica, connected standbys on a primary).
 *
 * All reads go through the shared Phase-2 read-only path. The scalar summary is
 * one round-trip (subselects), connections and standbys are one each — three
 * queries total, all plain SELECTs.
 */

import { z } from 'zod'

import { pgHostIdSchema, runPostgresReadOnly } from './postgres-helpers'
import { dynamicTool } from 'ai'

/** One-shot scalar summary: version, uptime, cache, xacts, size, recovery. */
const SUMMARY_SQL = `SELECT
  version() AS version,
  extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds,
  (SELECT sum(blks_hit) FROM pg_stat_database)::bigint AS blks_hit,
  (SELECT sum(blks_read) FROM pg_stat_database)::bigint AS blks_read,
  (SELECT sum(xact_commit) FROM pg_stat_database)::bigint AS xact_commit,
  (SELECT sum(xact_rollback) FROM pg_stat_database)::bigint AS xact_rollback,
  (SELECT sum(deadlocks) FROM pg_stat_database)::bigint AS deadlocks,
  pg_database_size(current_database())::bigint AS db_size_bytes,
  pg_size_pretty(pg_database_size(current_database())) AS db_size,
  pg_is_in_recovery() AS is_replica,
  CASE
    WHEN pg_is_in_recovery()
    THEN extract(epoch FROM (now() - pg_last_xact_replay_timestamp()))::float
    ELSE NULL
  END AS replica_lag_seconds,
  (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections`

/** Connection counts grouped by backend state. */
const CONNECTIONS_SQL = `SELECT coalesce(state, 'unknown') AS state, count(*)::int AS count
FROM pg_stat_activity
GROUP BY state
ORDER BY count DESC`

/** Connected standbys (primary side); empty on a replica or standalone. */
const STANDBYS_SQL = `SELECT
  application_name,
  client_addr::text AS client_addr,
  state,
  sync_state,
  extract(epoch FROM write_lag)::float AS write_lag_seconds,
  extract(epoch FROM flush_lag)::float AS flush_lag_seconds,
  extract(epoch FROM replay_lag)::float AS replay_lag_seconds
FROM pg_stat_replication`

type SummaryRow = {
  version: string
  uptime_seconds: number | string | null
  blks_hit: number | string | null
  blks_read: number | string | null
  xact_commit: number | string | null
  xact_rollback: number | string | null
  deadlocks: number | string | null
  db_size_bytes: number | string | null
  db_size: string | null
  is_replica: boolean
  replica_lag_seconds: number | null
  max_connections: number | string | null
}

/** Coerce a possibly-bigint-as-string numeric column to a JS number. */
function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : Number(v)
}

export function createPostgresHealthTools() {
  return {
    get_postgres_metrics: dynamicTool({
      description:
        'Get health metrics for a Postgres source: version and uptime, connection counts by state with max_connections and saturation percentage (pg_stat_activity + pg_settings), buffer-cache hit ratio (pg_stat_database), transaction commit/rollback and deadlock counts, current database size, and replication status (lag on a replica, connected standbys on a primary). The Postgres analog of ClickHouse `get_metrics`. Requires `pgHostId`.',
      inputSchema: z.object({
        pgHostId: pgHostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { pgHostId } = input as { pgHostId: number }

        const [summaryRes, connectionsRes, standbysRes] = await Promise.all([
          runPostgresReadOnly<SummaryRow>(pgHostId, SUMMARY_SQL),
          runPostgresReadOnly<{ state: string; count: number }>(
            pgHostId,
            CONNECTIONS_SQL
          ),
          runPostgresReadOnly<Record<string, unknown>>(pgHostId, STANDBYS_SQL),
        ])

        const s = summaryRes.rows[0]
        const blksHit = toNum(s?.blks_hit)
        const blksRead = toNum(s?.blks_read)
        const cacheDenom = blksHit + blksRead
        const cacheHitPct =
          cacheDenom > 0
            ? Math.round((blksHit * 10000) / cacheDenom) / 100
            : null

        const connectionsByState: Record<string, number> = {}
        let totalConnections = 0
        for (const row of connectionsRes.rows) {
          connectionsByState[row.state] = row.count
          totalConnections += row.count
        }

        const maxConnections = toNum(s?.max_connections)
        const saturationPct =
          maxConnections > 0
            ? Math.round((totalConnections * 10000) / maxConnections) / 100
            : null

        return {
          version: s?.version,
          uptime_seconds: toNum(s?.uptime_seconds),
          connections: {
            total: totalConnections,
            max: maxConnections,
            saturation_pct: saturationPct,
            by_state: connectionsByState,
          },
          cache: {
            blks_hit: blksHit,
            blks_read: blksRead,
            hit_pct: cacheHitPct,
          },
          transactions: {
            xact_commit: toNum(s?.xact_commit),
            xact_rollback: toNum(s?.xact_rollback),
            deadlocks: toNum(s?.deadlocks),
          },
          database: {
            size_bytes: toNum(s?.db_size_bytes),
            size: s?.db_size,
          },
          replication: {
            is_replica: Boolean(s?.is_replica),
            replica_lag_seconds: s?.replica_lag_seconds ?? null,
            standbys: standbysRes.rows,
          },
        }
      },
    }),
  }
}
