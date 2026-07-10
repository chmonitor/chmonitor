import type { PgQueryConfig } from '@/types/pg-query-config'

/**
 * Slow query patterns from `pg_stat_statements` — the Postgres analog of the
 * ClickHouse Slow Query Patterns view. Each row is a normalized statement with
 * aggregate execution metrics, mirroring ClickHouse Cloud's per-pattern Query
 * Insights (calls, total/mean exec time, spread, rows, cache hit, WAL bytes).
 *
 * Requires the `pg_stat_statements` extension (`extensionCheck`) — when it is
 * not installed the page shows a graceful "enable the extension" empty state
 * rather than surfacing a raw Postgres error.
 *
 * Column names follow `pg_stat_statements` on PostgreSQL 13+ (the `*_exec_time`
 * rename). `pct_total_time` / `pct_calls` are window-function share columns for
 * the inline BackgroundBar-style bars, matching the ClickHouse `pct_*`
 * convention.
 */
export const pgSlowPatternsConfig: PgQueryConfig = {
  name: 'pg-slow-patterns',
  title: 'Slow Query Patterns',
  description:
    'Normalized statements aggregated by pg_stat_statements — calls, execution time, spread, cache hit ratio, and WAL per pattern.',
  docs: 'https://www.postgresql.org/docs/current/pgstatstatements.html',
  extensionCheck: 'pg_stat_statements',
  rowClickable: true,
  sql: `
    SELECT
      queryid::text AS queryid,
      query,
      calls,
      round(total_exec_time::numeric, 2) AS total_exec_time,
      round(mean_exec_time::numeric, 2) AS mean_exec_time,
      round(stddev_exec_time::numeric, 2) AS stddev_exec_time,
      round(min_exec_time::numeric, 2) AS min_exec_time,
      round(max_exec_time::numeric, 2) AS max_exec_time,
      rows,
      shared_blks_hit,
      shared_blks_read,
      round(
        100.0 * shared_blks_hit
          / NULLIF(shared_blks_hit + shared_blks_read, 0),
        1
      ) AS cache_hit_ratio,
      wal_bytes,
      round(
        (100.0 * total_exec_time
          / NULLIF(SUM(total_exec_time) OVER (), 0))::numeric,
        1
      ) AS pct_total_time,
      round(
        (100.0 * calls / NULLIF(SUM(calls) OVER (), 0))::numeric,
        1
      ) AS pct_calls
    FROM pg_stat_statements
    ORDER BY total_exec_time DESC
    LIMIT 100
  `.trim(),
  columns: [
    { key: 'query', label: 'Query', format: 'code' },
    {
      key: 'calls',
      label: 'Calls',
      format: 'number',
      align: 'right',
      barPctKey: 'pct_calls',
    },
    {
      key: 'total_exec_time',
      label: 'Total time',
      format: 'ms',
      align: 'right',
      barPctKey: 'pct_total_time',
      help: 'Total execution time across all calls (ms)',
    },
    {
      key: 'mean_exec_time',
      label: 'Mean',
      format: 'ms',
      align: 'right',
      help: 'Mean execution time per call (ms)',
    },
    {
      key: 'stddev_exec_time',
      label: 'Std dev',
      format: 'ms',
      align: 'right',
      help: 'Standard deviation of execution time — spread proxy for percentiles',
    },
    {
      key: 'max_exec_time',
      label: 'Max',
      format: 'ms',
      align: 'right',
    },
    { key: 'rows', label: 'Rows', format: 'number', align: 'right' },
    {
      key: 'cache_hit_ratio',
      label: 'Cache hit',
      format: 'percent',
      align: 'right',
      help: 'shared_blks_hit / (hit + read)',
    },
    { key: 'wal_bytes', label: 'WAL', format: 'bytes', align: 'right' },
  ],
}
