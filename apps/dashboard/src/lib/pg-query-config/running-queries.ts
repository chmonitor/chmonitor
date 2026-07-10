import type { PgQueryConfig } from '@/types/pg-query-config'

/**
 * Currently-running queries from `pg_stat_activity` — the Postgres analog of
 * ClickHouse's Running Queries view. One row per active backend, with state,
 * wait event, and how long the current statement has been running.
 *
 * No extension required (`pg_stat_activity` is always present). We exclude our
 * own monitoring backend (`pid <> pg_backend_pid()`) and rows with no
 * statement text so the view shows real client activity.
 */
export const pgRunningQueriesConfig: PgQueryConfig = {
  name: 'pg-running-queries',
  title: 'Running Queries',
  description:
    'Live client backends from pg_stat_activity — state, wait events, and current-statement duration.',
  docs: 'https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW',
  rowClickable: true,
  sql: `
    SELECT
      pid,
      usename AS username,
      datname AS database,
      state,
      wait_event_type,
      wait_event,
      round(
        EXTRACT(EPOCH FROM (now() - query_start)) * 1000
      )::bigint AS duration_ms,
      query
    FROM pg_stat_activity
    WHERE state IS NOT NULL
      AND query <> ''
      AND pid <> pg_backend_pid()
    ORDER BY query_start ASC NULLS LAST
    LIMIT 200
  `.trim(),
  columns: [
    { key: 'pid', label: 'PID', format: 'number', align: 'right' },
    { key: 'state', label: 'State', format: 'text' },
    {
      key: 'duration_ms',
      label: 'Duration',
      format: 'duration_ms',
      align: 'right',
      help: 'How long the current statement has been running',
    },
    { key: 'username', label: 'User', format: 'text' },
    { key: 'database', label: 'Database', format: 'text' },
    {
      key: 'wait_event_type',
      label: 'Wait type',
      format: 'text',
    },
    { key: 'wait_event', label: 'Wait event', format: 'text' },
    { key: 'query', label: 'Query', format: 'code' },
  ],
}
