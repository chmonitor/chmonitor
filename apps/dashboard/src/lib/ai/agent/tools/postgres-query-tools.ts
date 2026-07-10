/**
 * Postgres query tools for the agent (cross-source, env-gated).
 *
 * `run_postgres_select_query` is the Postgres analog of the ClickHouse `query`
 * tool: a read-only-enforced SELECT primitive. `list_postgres_slow_query_patterns`
 * mirrors ClickHouse's `list_slow_query_patterns`, but over `pg_stat_statements`.
 *
 * Both resolve a per-call `pgHostId` and run through the shared Phase-2
 * read-only path (`runPostgresReadOnly` → `queryPostgres`). Cross-source
 * correlation is prompting-only: the model calls a ClickHouse tool and one of
 * these in the same turn and correlates the results itself — no join primitive.
 */

import { z } from 'zod'

import { capResultRows, truncationNote } from './helpers'
import { pgHostIdSchema, runPostgresReadOnly } from './postgres-helpers'
import { dynamicTool } from 'ai'

/** Top-N `pg_stat_statements` patterns ranked by total execution time. */
const SLOW_PATTERNS_SQL = `SELECT
  queryid::text AS queryid,
  query,
  calls,
  round(total_exec_time::numeric, 2) AS total_exec_ms,
  round(mean_exec_time::numeric, 2) AS mean_exec_ms,
  rows,
  round(
    shared_blks_hit * 100.0 / nullif(shared_blks_hit + shared_blks_read, 0),
    2
  ) AS cache_hit_pct,
  wal_bytes
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT $1`

export function createPostgresQueryTools() {
  return {
    run_postgres_select_query: dynamicTool({
      description:
        'Execute a read-only SQL query against a Postgres source. Only a single SELECT / WITH / SHOW / EXPLAIN / TABLE / VALUES statement is allowed (writes, DDL, and multi-statement strings are rejected, and the session is pinned read-only server-side). Use this to inspect a Postgres database and, in the same conversation, correlate its data with ClickHouse results from the `query` tool. Requires `pgHostId` (the Postgres source index).',
      inputSchema: z.object({
        sql: z.string().describe('The read-only SQL query to execute'),
        pgHostId: pgHostIdSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe(
            'Optional cap on rows returned to the model (default 1000).'
          ),
      }),
      execute: async (input: unknown) => {
        const { sql, pgHostId, limit } = input as {
          sql: string
          pgHostId: number
          limit?: number
        }
        const { rows } = await runPostgresReadOnly(pgHostId, sql)
        const { data, truncated } = capResultRows(rows, limit)
        return {
          data,
          truncated,
          ...(truncated && { note: truncationNote(limit) }),
        }
      },
    }),

    list_postgres_slow_query_patterns: dynamicTool({
      description:
        'List the slowest NORMALIZED query patterns on a Postgres source — `pg_stat_statements` aggregated per normalized statement, ranked by total execution time, with calls, total/mean exec time (ms), rows, shared-buffer cache-hit ratio, and WAL bytes. The Postgres analog of ClickHouse `list_slow_query_patterns`; use it as the first step of a "why is this Postgres database slow?" investigation. Requires `pgHostId`. Returns an informative message (not an error) when the `pg_stat_statements` extension is not installed.',
      inputSchema: z.object({
        pgHostId: pgHostIdSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(10)
          .describe('Number of top patterns to return (default 10).'),
      }),
      execute: async (input: unknown) => {
        const { pgHostId, limit = 10 } = input as {
          pgHostId: number
          limit?: number
        }

        // Graceful degradation: pg_stat_statements is an optional extension.
        // Probe pg_extension first so a missing extension yields an
        // informative result instead of an "undefined table" throw.
        const { rows: extRows } = await runPostgresReadOnly<{
          present: number
        }>(
          pgHostId,
          "SELECT count(*)::int AS present FROM pg_extension WHERE extname = 'pg_stat_statements'"
        )
        if (!extRows[0]?.present) {
          return {
            available: false,
            message:
              'The pg_stat_statements extension is not installed on this Postgres source, so normalized slow-query patterns are unavailable. Ask an administrator to add it (shared_preload_libraries + CREATE EXTENSION pg_stat_statements), or use run_postgres_select_query against pg_stat_activity for currently-running queries instead.',
          }
        }

        const { rows } = await runPostgresReadOnly(
          pgHostId,
          SLOW_PATTERNS_SQL,
          [limit]
        )
        return { available: true, patterns: rows }
      },
    }),
  }
}
