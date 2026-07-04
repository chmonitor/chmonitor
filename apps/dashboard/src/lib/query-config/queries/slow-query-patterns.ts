import { ClockIcon, DatabaseIcon, LayersIcon, UserIcon } from 'lucide-react'

import type { FilterSchema } from '@/lib/filters/types'
import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { FILTER_PLACEHOLDER } from '@/lib/filters/where-builder'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Raw rows contributing to a normalized query pattern, before `GROUP BY
 * normalized_query_hash`. Filters from {@link slowQueryPatternsFilterSchema}
 * apply here (via {@link FILTER_PLACEHOLDER}) so "filter by user" narrows the
 * executions that feed a pattern, not the pattern's representative values.
 */
const rawRowsSelect = `
    SELECT
        normalized_query_hash,
        query,
        user,
        query_kind,
        current_database,
        event_time,
        query_duration_ms,
        memory_usage,
        read_rows,
        read_bytes,
        written_bytes,
        result_rows,
        exception_code,
        ProfileEvents`

const queryLogDynamicOptions = (column: string) => ({
  table: 'system.query_log',
  column,
  where: 'event_time > now() - toIntervalDay(7)',
})

/**
 * Schema-driven filter definition for the Slow Query Patterns page.
 * Time window defaults to the last 24 hours so the aggregation stays cheap;
 * the user can widen or narrow it (and filter by user/query_kind/database)
 * from the filter bar.
 */
export const slowQueryPatternsFilterSchema: FilterSchema = {
  fields: [
    {
      key: 'event_time',
      column: 'event_time',
      label: 'Time',
      type: 'datetime',
      operators: ['withinHours', 'between', 'gte', 'lte'],
      icon: ClockIcon,
      options: [
        { label: 'Last 1 hour', value: '1' },
        { label: 'Last 6 hours', value: '6' },
        { label: 'Last 24 hours', value: '24' },
        { label: 'Last 7 days', value: '168' },
        { label: 'Last 30 days', value: '720' },
      ],
      description: 'Relative window or an explicit date range.',
      defaultValue: { operator: 'withinHours', value: '24' },
    },
    {
      key: 'user',
      column: 'user',
      label: 'User',
      type: 'select',
      operators: ['in', 'notIn', 'eq', 'ne', 'contains'],
      dynamicOptions: queryLogDynamicOptions('user'),
      icon: UserIcon,
      description: 'Restrict the underlying executions to this user.',
    },
    {
      key: 'query_kind',
      column: 'query_kind',
      label: 'Query kind',
      type: 'select',
      operators: ['in', 'eq', 'ne'],
      icon: LayersIcon,
      options: [
        { label: 'Select', value: 'Select' },
        { label: 'Insert', value: 'Insert' },
        { label: 'Create', value: 'Create' },
        { label: 'Alter', value: 'Alter' },
        { label: 'Drop', value: 'Drop' },
        { label: 'Rename', value: 'Rename' },
        { label: 'Optimize', value: 'Optimize' },
        { label: 'System', value: 'System' },
        { label: 'Show', value: 'Show' },
        { label: 'Set', value: 'Set' },
        { label: 'Backup', value: 'Backup' },
      ],
    },
    {
      key: 'database',
      column: 'current_database',
      label: 'Database',
      type: 'select',
      operators: ['in', 'eq', 'ne', 'contains'],
      dynamicOptions: queryLogDynamicOptions('current_database'),
      icon: DatabaseIcon,
    },
  ],
  presets: [
    {
      name: 'Last hour',
      icon: ClockIcon,
      filters: [{ key: 'event_time', operator: 'withinHours', value: '1' }],
    },
    {
      name: 'Selects only',
      icon: LayersIcon,
      filters: [{ key: 'query_kind', operator: 'in', value: 'Select' }],
    },
  ],
}

/**
 * Build the versioned slow-query-patterns SQL, parameterized by the WHERE
 * fragment applied to the raw `filtered` rows before aggregation. The
 * dashboard page injects the schema-driven {@link FILTER_PLACEHOLDER}; the
 * insights detail endpoint (`/api/v1/insights/query-patterns/:hash`) reuses
 * this same aggregation scoped to one `normalized_query_hash` — a single
 * source of truth for the pattern metrics instead of duplicating the SQL.
 */
export function buildQueryPatternsSql(whereFragment: string): VersionedSql[] {
  return [
    {
      since: '19.1',
      description: 'Base query without query_cache_usage',
      sql: `
    WITH filtered AS (
      SELECT q.* FROM (
${rawRowsSelect}
        FROM system.query_log
        WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
      ) AS q
      ${whereFragment}
    ),
    base_metrics AS (
      SELECT
          normalized_query_hash,
          any(query) AS normalized_query,
          any(user) AS user,
          any(query_kind) AS query_kind,
          any(current_database) AS database,
          count() AS calls,
          sum(query_duration_ms) / 1000 AS total_duration,
          avg(query_duration_ms) / 1000 AS avg_duration,
          quantile(0.5)(query_duration_ms) / 1000 AS p50_duration,
          quantile(0.95)(query_duration_ms) / 1000 AS p95_duration,
          quantile(0.99)(query_duration_ms) / 1000 AS p99_duration,
          max(query_duration_ms) / 1000 AS max_duration,
          sum(ProfileEvents['OSCPUVirtualTimeMicroseconds']) / 1000000 AS cpu_time,
          max(memory_usage) AS peak_memory,
          formatReadableSize(max(memory_usage)) AS readable_peak_memory,
          sum(read_rows) AS read_rows,
          formatReadableQuantity(sum(read_rows)) AS readable_read_rows,
          sum(read_bytes) AS read_bytes,
          formatReadableSize(sum(read_bytes)) AS readable_read_bytes,
          sum(result_rows) AS result_rows,
          formatReadableQuantity(sum(result_rows)) AS readable_result_rows,
          sum(written_bytes) AS written_bytes,
          formatReadableSize(sum(written_bytes)) AS readable_written_bytes,
          countIf(exception_code != 0) AS errors,
          0 AS cache_hit_ratio
      FROM filtered
      GROUP BY normalized_query_hash
    )
    SELECT
        *,
        round(100 * calls / nullIf(max(calls) OVER (), 0), 2) AS pct_calls,
        round(100 * peak_memory / nullIf(max(peak_memory) OVER (), 0), 2) AS pct_peak_memory,
        round(100 * read_rows / nullIf(max(read_rows) OVER (), 0), 2) AS pct_read_rows,
        round(100 * read_bytes / nullIf(max(read_bytes) OVER (), 0), 2) AS pct_read_bytes,
        round(100 * result_rows / nullIf(max(result_rows) OVER (), 0), 2) AS pct_result_rows,
        round(100 * written_bytes / nullIf(max(written_bytes) OVER (), 0), 2) AS pct_written_bytes,
        round(100 * cache_hit_ratio / nullIf(max(cache_hit_ratio) OVER (), 0), 2) AS pct_cache_hit_ratio
    FROM base_metrics
    ORDER BY total_duration DESC
    LIMIT 1000
  `,
    },
    {
      since: '24.1',
      description:
        'Added query_cache_usage-derived cache_hit_ratio (query_cache_usage requires CH 24.1+)',
      sql: `
    WITH filtered AS (
      SELECT q.* FROM (
${rawRowsSelect},
        query_cache_usage
        FROM system.query_log
        WHERE type IN ('QueryFinish', 'ExceptionWhileProcessing')
      ) AS q
      ${whereFragment}
    ),
    base_metrics AS (
      SELECT
          normalized_query_hash,
          any(query) AS normalized_query,
          any(user) AS user,
          any(query_kind) AS query_kind,
          any(current_database) AS database,
          count() AS calls,
          sum(query_duration_ms) / 1000 AS total_duration,
          avg(query_duration_ms) / 1000 AS avg_duration,
          quantile(0.5)(query_duration_ms) / 1000 AS p50_duration,
          quantile(0.95)(query_duration_ms) / 1000 AS p95_duration,
          quantile(0.99)(query_duration_ms) / 1000 AS p99_duration,
          max(query_duration_ms) / 1000 AS max_duration,
          sum(ProfileEvents['OSCPUVirtualTimeMicroseconds']) / 1000000 AS cpu_time,
          max(memory_usage) AS peak_memory,
          formatReadableSize(max(memory_usage)) AS readable_peak_memory,
          sum(read_rows) AS read_rows,
          formatReadableQuantity(sum(read_rows)) AS readable_read_rows,
          sum(read_bytes) AS read_bytes,
          formatReadableSize(sum(read_bytes)) AS readable_read_bytes,
          sum(result_rows) AS result_rows,
          formatReadableQuantity(sum(result_rows)) AS readable_result_rows,
          sum(written_bytes) AS written_bytes,
          formatReadableSize(sum(written_bytes)) AS readable_written_bytes,
          countIf(exception_code != 0) AS errors,
          round(100 * countIf(query_cache_usage = 'Read') / count(), 2) AS cache_hit_ratio
      FROM filtered
      GROUP BY normalized_query_hash
    )
    SELECT
        *,
        round(100 * calls / nullIf(max(calls) OVER (), 0), 2) AS pct_calls,
        round(100 * peak_memory / nullIf(max(peak_memory) OVER (), 0), 2) AS pct_peak_memory,
        round(100 * read_rows / nullIf(max(read_rows) OVER (), 0), 2) AS pct_read_rows,
        round(100 * read_bytes / nullIf(max(read_bytes) OVER (), 0), 2) AS pct_read_bytes,
        round(100 * result_rows / nullIf(max(result_rows) OVER (), 0), 2) AS pct_result_rows,
        round(100 * written_bytes / nullIf(max(written_bytes) OVER (), 0), 2) AS pct_written_bytes,
        round(100 * cache_hit_ratio / nullIf(max(cache_hit_ratio) OVER (), 0), 2) AS pct_cache_hit_ratio
    FROM base_metrics
    ORDER BY total_duration DESC
    LIMIT 1000
  `,
    },
  ]
}

/**
 * Normalized slow-query patterns: `system.query_log` aggregated by
 * `normalized_query_hash`, mirroring ClickHouse Cloud's Query Insights
 * "Slow Patterns" table. Foundation for the rest of the Query Insights epic
 * (overview cards, detail flyout, insights API) — keep column names stable.
 */
export const slowQueryPatternsConfig: QueryConfig = {
  name: 'slow-query-patterns',
  description:
    'Query patterns aggregated by normalized_query_hash — calls, duration percentiles, resource usage, and errors per pattern',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  filterSchema: slowQueryPatternsFilterSchema,
  sql: buildQueryPatternsSql(FILTER_PLACEHOLDER),

  rowClassName: (row) => {
    const totalDuration = Number(row.total_duration || 0)
    if (totalDuration > 60) return 'bg-red-50 dark:bg-red-950/20'
    if (totalDuration > 10) return 'bg-amber-50 dark:bg-amber-950/20'
    return undefined
  },

  columns: [
    'action',
    'normalized_query',
    'calls',
    'total_duration',
    'avg_duration',
    'p50_duration',
    'p95_duration',
    'p99_duration',
    'max_duration',
    'cpu_time',
    'readable_peak_memory',
    'readable_read_rows',
    'readable_read_bytes',
    'readable_result_rows',
    'readable_written_bytes',
    'errors',
    'cache_hit_ratio',
    'user',
    'query_kind',
    'database',
  ],
  columnIcons: {
    user: UserIcon,
    query_kind: LayersIcon,
    database: DatabaseIcon,
    total_duration: ClockIcon,
  },
  columnFormats: {
    action: [ColumnFormat.Action, ['open-in-explorer', 'analyze-with-ai']],
    normalized_query: [
      ColumnFormat.CodeDialog,
      { max_truncate: 100, hide_query_comment: true },
    ],
    calls: [ColumnFormat.BackgroundBar, { numberFormat: true }],
    total_duration: ColumnFormat.Duration,
    avg_duration: ColumnFormat.Duration,
    p50_duration: ColumnFormat.Duration,
    p95_duration: ColumnFormat.Duration,
    p99_duration: ColumnFormat.Duration,
    max_duration: ColumnFormat.Duration,
    cpu_time: ColumnFormat.Duration,
    readable_peak_memory: ColumnFormat.BackgroundBar,
    readable_read_rows: ColumnFormat.BackgroundBar,
    readable_read_bytes: ColumnFormat.BackgroundBar,
    readable_result_rows: ColumnFormat.BackgroundBar,
    readable_written_bytes: ColumnFormat.BackgroundBar,
    errors: ColumnFormat.Number,
    cache_hit_ratio: ColumnFormat.BackgroundBar,
    user: ColumnFormat.ColoredBadge,
    query_kind: ColumnFormat.ColoredBadge,
    database: ColumnFormat.Badge,
  },
  columnDescriptions: {
    normalized_query: 'Representative query text for this pattern',
    calls: 'Number of executions matching this normalized query',
    total_duration: 'Sum of query_duration_ms across all calls (seconds)',
    avg_duration: 'Average query_duration_ms per call (seconds)',
    p50_duration: 'Median query duration (seconds)',
    p95_duration: '95th percentile query duration (seconds)',
    p99_duration: '99th percentile query duration (seconds)',
    max_duration: 'Slowest single execution (seconds)',
    cpu_time: "Sum of ProfileEvents['OSCPUVirtualTimeMicroseconds'] (seconds)",
    cache_hit_ratio:
      'Share of calls served from the query cache (CH 24.1+; 0 on older versions)',
    errors: 'Count of calls with a non-zero exception_code',
  },
}
