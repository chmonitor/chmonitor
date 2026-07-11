/**
 * Postgres table-stats tool for the agent (cross-source, env-gated).
 *
 * `get_postgres_table_stats` summarizes table-level health for a Postgres
 * source: the tables with the worst dead-tuple bloat (autovacuum falling
 * behind), their last autovacuum/analyze times, and the unused indexes
 * (`idx_scan = 0`, excluding PK / unique-constraint indexes). It complements
 * `get_postgres_metrics` (server-wide) with the per-table detail an operator
 * needs to plan VACUUM / index cleanup — the same signals the Postgres insight
 * collectors surface, exposed to the agent for interactive investigation.
 *
 * All reads go through the shared Phase-2 read-only path. Two plain SELECTs.
 */

import { z } from 'zod'

import { pgHostIdSchema, runPostgresReadOnly } from './postgres-helpers'
import { dynamicTool } from 'ai'

/** Worst dead-tuple bloat + last (auto)vacuum/analyze per table. */
const DEAD_TUPLE_TABLES_SQL = `SELECT
  (schemaname || '.' || relname) AS table_name,
  n_live_tup,
  n_dead_tup,
  round(n_dead_tup::numeric * 100 / nullif(n_live_tup, 0), 1) AS dead_pct,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup::float / nullif(n_live_tup, 0) DESC NULLS LAST
LIMIT $1`

/** Unused indexes (never scanned), excluding PK / unique-constraint indexes. */
const UNUSED_INDEXES_SQL = `SELECT
  (s.schemaname || '.' || s.relname) AS table_name,
  s.indexrelname AS index_name,
  s.idx_scan,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  pg_relation_size(s.indexrelid) AS index_size_bytes
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique
  AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT $1`

export function createPostgresTableTools() {
  return {
    get_postgres_table_stats: dynamicTool({
      description:
        'Get per-table health for a Postgres source: the tables with the worst dead-tuple bloat (dead vs live tuples, dead %, and last vacuum/autovacuum/analyze times from pg_stat_user_tables) and the unused indexes (idx_scan = 0, excluding primary-key and unique-constraint indexes, with their on-disk size from pg_stat_user_indexes). Use this to plan VACUUM / autovacuum tuning and index cleanup. The per-table companion to `get_postgres_metrics`. Requires `pgHostId`.',
      inputSchema: z.object({
        pgHostId: pgHostIdSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(10)
          .describe(
            'Max rows for each of the two sections (bloated tables, unused indexes). Default 10.'
          ),
      }),
      execute: async (input: unknown) => {
        const { pgHostId, limit = 10 } = input as {
          pgHostId: number
          limit?: number
        }

        const [tablesRes, indexesRes] = await Promise.all([
          runPostgresReadOnly(pgHostId, DEAD_TUPLE_TABLES_SQL, [limit]),
          runPostgresReadOnly(pgHostId, UNUSED_INDEXES_SQL, [limit]),
        ])

        return {
          bloated_tables: tablesRes.rows,
          unused_indexes: indexesRes.rows,
        }
      },
    }),
  }
}
