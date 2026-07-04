import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * Per-user activity summary.
 *
 * The old version read only `system.processes` (momentary, live-only), so a
 * user with no in-flight query showed `0.00 B` and the page was near-empty. This
 * config keeps the live snapshot but drives the table from a per-user aggregate
 * of `system.query_log`, so every user who ran queries in the selected window
 * shows real numbers even when idle right now.
 *
 * Shape: `hist` (query_log, GROUP BY user) is the base of a LEFT JOIN to `live`
 * (processes, GROUP BY user). LEFT-from-hist guarantees history-only users
 * appear (the reported bug). A user whose *only* activity is an in-flight query
 * with nothing finished in the window is omitted until it finishes — an
 * acceptable, rare gap (FULL JOIN + USING key coalescing is version-fragile
 * across 23.8→26.6, so we avoid it).
 *
 * The window is dynamic: `{last_hours}` (default 24h) is bound from the
 * `last_hours` URL param via the preset bar in `user-processes-view.tsx`, so the
 * historical columns recompute. All referenced query_log columns
 * (`read_bytes`, `read_rows`, `query_duration_ms`, `type`, `event_time`, `user`,
 * `memory_usage`) are schema-stable, so a single SQL string covers all versions.
 */
export const userProcessesConfig: QueryConfig = {
  name: 'user-processes',
  defaultView: 'auto',
  card: {
    primary: 'user',
    metrics: [
      'readable_queries',
      'current_queries',
      'readable_memory_usage',
      'last_query_time',
    ],
  },
  description:
    'Per-user live queries plus historical activity over the selected window',
  refreshInterval: 30_000,
  // Depends on system.query_log; degrade gracefully if query logging is off.
  optional: true,
  tableCheck: 'system.query_log',
  defaultParams: {
    last_hours: '24',
  },
  filterParamPresets: [
    { name: 'Last 1h', key: 'last_hours', value: '1' },
    { name: 'Last 6h', key: 'last_hours', value: '6' },
    { name: 'Last 24h', key: 'last_hours', value: '24' },
    { name: 'Last 7d', key: 'last_hours', value: '168' },
  ],
  // BackgroundBar requires base + readable_{column} + pct_{column}.
  sql: `
    WITH
      live AS (
        SELECT
          user,
          count() AS current_queries,
          sum(memory_usage) AS memory_usage,
          max(peak_memory_usage) AS peak_memory_usage
        FROM system.processes
        GROUP BY user
      ),
      hist AS (
        SELECT
          user,
          count() AS queries,
          countIf(event_time > now() - interval 1 hour) AS queries_1h,
          countIf(type IN (3, 4)) AS failed_queries,
          sum(read_bytes) AS data_scanned,
          sum(read_rows) AS rows_read,
          sumIf(query_duration_ms, type = 2) / 1000 AS total_query_duration,
          sumIf(query_duration_ms, type = 2) / 1000 / nullIf(countIf(type = 2), 0) AS avg_query_duration,
          max(event_time) AS last_query_time
        FROM system.query_log
        WHERE type IN (2, 3, 4)
          AND event_time > now() - interval {last_hours:UInt64} hour
        GROUP BY user
      )
    SELECT
      user,
      current_queries,
      memory_usage,
      formatReadableSize(memory_usage) AS readable_memory_usage,
      round(memory_usage * 100.0 / nullIf(max(memory_usage) OVER (), 0), 2) AS pct_memory_usage,
      peak_memory_usage,
      formatReadableSize(peak_memory_usage) AS readable_peak_memory_usage,
      round(peak_memory_usage * 100.0 / nullIf(max(peak_memory_usage) OVER (), 0), 2) AS pct_peak_memory_usage,
      queries,
      formatReadableQuantity(queries) AS readable_queries,
      round(queries * 100.0 / nullIf(max(queries) OVER (), 0), 2) AS pct_queries,
      queries_1h,
      failed_queries,
      data_scanned,
      formatReadableSize(data_scanned) AS readable_data_scanned,
      round(data_scanned * 100.0 / nullIf(max(data_scanned) OVER (), 0), 2) AS pct_data_scanned,
      rows_read,
      formatReadableQuantity(rows_read) AS readable_rows_read,
      round(rows_read * 100.0 / nullIf(max(rows_read) OVER (), 0), 2) AS pct_rows_read,
      total_query_duration,
      avg_query_duration,
      last_query_time
    FROM hist
    LEFT JOIN live USING (user)
    ORDER BY queries DESC, current_queries DESC
  `,
  columns: [
    'user',
    'current_queries',
    'readable_memory_usage',
    'readable_peak_memory_usage',
    'readable_queries',
    'queries_1h',
    'failed_queries',
    'readable_data_scanned',
    'readable_rows_read',
    'avg_query_duration',
    'total_query_duration',
    'last_query_time',
  ],
  columnFormats: {
    user: ColumnFormat.ColoredBadge,
    current_queries: ColumnFormat.Number,
    readable_memory_usage: ColumnFormat.BackgroundBar,
    readable_peak_memory_usage: ColumnFormat.BackgroundBar,
    readable_queries: ColumnFormat.BackgroundBar,
    queries_1h: ColumnFormat.Number,
    failed_queries: ColumnFormat.Number,
    readable_data_scanned: ColumnFormat.BackgroundBar,
    readable_rows_read: ColumnFormat.BackgroundBar,
    avg_query_duration: ColumnFormat.Duration,
    total_query_duration: ColumnFormat.Duration,
    last_query_time: ColumnFormat.RelatedTime,
  },
  columnDescriptions: {
    current_queries: 'In-flight queries right now (system.processes)',
    readable_memory_usage:
      'Live memory used by in-flight queries (system.processes)',
    readable_peak_memory_usage:
      'Peak memory across in-flight queries (system.processes)',
    readable_queries:
      'Finished + failed queries in the selected window (system.query_log)',
    queries_1h: 'Queries in the last 1 hour',
    failed_queries: 'Queries that ended in an exception in the selected window',
    readable_data_scanned:
      'Total bytes read from storage in the selected window',
    readable_rows_read: 'Total rows read in the selected window',
    avg_query_duration: 'Average duration of successful queries in the window',
    total_query_duration: 'Total time of successful queries in the window',
    last_query_time: 'Most recent query activity',
  },
  sortingFns: {
    readable_memory_usage: 'sort_column_using_actual_value',
    readable_peak_memory_usage: 'sort_column_using_actual_value',
    readable_queries: 'sort_column_using_actual_value',
    readable_data_scanned: 'sort_column_using_actual_value',
    readable_rows_read: 'sort_column_using_actual_value',
  },
}
