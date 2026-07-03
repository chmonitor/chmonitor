import type { DeclarativeQueryConfig } from '../../schema'

// Declarative twin of lib/query-config/system/query-metric-log.ts. The catalog
// snapshot test deep-equals the serializable fields (sql / columns /
// columnFormats / sortingFns / relatedCharts) against the imperative config, so
// this SQL string and those fields must stay byte-identical with it. The
// imperative-only `expandable` (a bespoke React panel) is intentionally not
// represented here — it's excluded from the comparison and cannot be expressed
// declaratively.
const QUERY_METRIC_LOG_SQL = `
      WITH per_query AS (
        SELECT
          query_id,
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
        memory_usage AS memory,
        formatReadableSize(memory_usage) AS readable_memory,
        round(memory_usage * 100.0 / nullIf(max(memory_usage) OVER (), 0), 2) AS pct_memory,
        peak_memory_usage AS peak_memory,
        formatReadableSize(peak_memory_usage) AS readable_peak_memory,
        round(peak_memory_usage * 100.0 / nullIf(max(peak_memory_usage) OVER (), 0), 2) AS pct_peak_memory,
        selected_rows,
        real_time_us AS real_time,
        multiIf(real_time_us >= 1000000, concat(toString(round(real_time_us / 1000000, 2)), ' s'),
                real_time_us >= 1000, concat(toString(round(real_time_us / 1000, 2)), ' ms'),
                concat(toString(real_time_us), ' us')) AS readable_real_time,
        round(real_time_us * 100.0 / nullIf(max(real_time_us) OVER (), 0), 2) AS pct_real_time,
        cpu_time_us AS cpu_time,
        multiIf(cpu_time_us >= 1000000, concat(toString(round(cpu_time_us / 1000000, 2)), ' s'),
                cpu_time_us >= 1000, concat(toString(round(cpu_time_us / 1000, 2)), ' ms'),
                concat(toString(cpu_time_us), ' us')) AS readable_cpu_time,
        round(cpu_time_us * 100.0 / nullIf(max(cpu_time_us) OVER (), 0), 2) AS pct_cpu_time
      FROM per_query
      ORDER BY event_time DESC
      LIMIT 100
    `

export const queryMetricLogDeclarative: DeclarativeQueryConfig = {
  name: 'query-metric-log',
  description:
    'Per-query resource usage sampled over each query lifetime from system.query_metric_log',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_metric_log',
  refreshInterval: 30_000,
  // system.query_metric_log is opt-in and may not exist on every server / version
  optional: true,
  tableCheck: 'system.query_metric_log',
  defaultParams: {
    query_id: '',
    last_hours: '1',
  },
  filterParamPresets: [
    { name: 'Last 1 hour', key: 'last_hours', value: '1' },
    { name: 'Last 6 hours', key: 'last_hours', value: '6' },
    { name: 'Last 24 hours', key: 'last_hours', value: '24' },
  ],
  // system.query_metric_log landed in ClickHouse 24.5; the columns used here are
  // stable across every version that ships the table, so a single variant
  // applies (the executor falls back to the oldest entry on older/unknown
  // versions, where `optional` + `tableCheck` gate execution).
  sql: [{ since: '24.5', sql: QUERY_METRIC_LOG_SQL }],
  columns: [
    'query_id',
    'event_time',
    'readable_memory',
    'readable_peak_memory',
    'selected_rows',
    'readable_real_time',
    'readable_cpu_time',
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
    readable_real_time: 'background-bar',
    readable_cpu_time: 'background-bar',
  },
  sortingFns: {
    readable_memory: 'sort_column_using_actual_value',
    readable_peak_memory: 'sort_column_using_actual_value',
    readable_real_time: 'sort_column_using_actual_value',
    readable_cpu_time: 'sort_column_using_actual_value',
  },
  relatedCharts: [
    [
      'query-metric-log-memory',
      {
        title: 'Sampled Query Memory',
        colSpan: 10,
      },
    ],
  ],
}
