import type { DeclarativeQueryConfig } from '../../schema'

export const queryMetricLogDeclarative: DeclarativeQueryConfig = {
  name: 'query-metric-log',
  description:
    'Per-query resource usage sampled over each query lifetime from system.query_metric_log',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_metric_log',
  refreshInterval: 30_000,
  // system.query_metric_log is opt-in and may not exist on every server / version
  optional: true,
  tableCheck: 'system.query_metric_log',
  // Pre-aggregate one row per query instead of returning every raw per-interval
  // sample. system.query_metric_log is high-cardinality (one row per query per
  // sampling interval), so a raw SELECT can scan enough data to exceed Cloudflare
  // Worker CPU/memory limits (HTTP 503). Aggregating server-side and bounding
  // the time window keeps the result small and useful.
  //
  // When query_id is provided (e.g. from the "View Resource Timeline" action),
  // the result is filtered to that single query.
  defaultParams: {
    query_id: '',
    last_hours: '1',
  },
  filterParamPresets: [
    { name: 'Last 1 hour', key: 'last_hours', value: '1' },
    { name: 'Last 6 hours', key: 'last_hours', value: '6' },
    { name: 'Last 24 hours', key: 'last_hours', value: '24' },
  ],
  sql: `
      WITH per_query AS (
        SELECT
          query_id,
          -- NOT "AS event_time": the new ClickHouse analyzer resolves the WHERE
          -- column to this aggregate alias (it shadows the raw column) and rejects
          -- "aggregate function in WHERE". Use a distinct name, re-alias below.
          max(event_time) AS last_event_time,
          max(memory_usage) AS memory_usage,
          max(peak_memory_usage) AS peak_memory_usage,
          max(ProfileEvent_SelectedRows) AS selected_rows,
          max(ProfileEvent_RealTimeMicroseconds) AS real_time_us,
          max(ProfileEvent_OSCPUVirtualTimeMicroseconds) AS cpu_time_us
        FROM system.query_metric_log
        WHERE event_time >= now() - INTERVAL {last_hours:UInt64} HOUR
          AND ({query_id:String} = '' OR query_id = {query_id:String})
        GROUP BY query_id
      )
      SELECT
        query_id,
        last_event_time AS event_time,
        formatReadableSize(memory_usage) AS readable_memory,
        round(memory_usage * 100.0 / nullIf(max(memory_usage) OVER (), 0), 2) AS pct_memory,
        formatReadableSize(peak_memory_usage) AS readable_peak_memory,
        round(peak_memory_usage * 100.0 / nullIf(max(peak_memory_usage) OVER (), 0), 2) AS pct_peak_memory,
        selected_rows,
        real_time_us,
        cpu_time_us
      FROM per_query
      ORDER BY event_time DESC
      LIMIT 100
    `,
  columns: [
    'query_id',
    'event_time',
    'readable_memory',
    'readable_peak_memory',
    'selected_rows',
    'real_time_us',
    'cpu_time_us',
  ],
  columnFormats: {
    query_id: [
      'link',
      {
        href: '/query?query_id=[query_id]&host=[ctx.hostId]',
        className: 'truncate max-w-48 font-mono text-xs',
        title: 'View query detail',
      },
    ],
    readable_memory: 'background-bar',
    readable_peak_memory: 'background-bar',
    selected_rows: 'number-short',
    real_time_us: 'number-short',
    cpu_time_us: 'number-short',
  },
}
