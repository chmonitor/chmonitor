import type { DeclarativeQueryConfig } from '../../schema'

export const threadAnalysisDeclarative: DeclarativeQueryConfig = {
  name: 'thread-analysis',
  description: 'Per-thread query execution statistics',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_thread_log',
  defaultView: 'auto',
  card: { primary: 'thread_name' },
  optional: true,
  tableCheck: 'system.query_thread_log',
  sql: `
    SELECT
      query_id,
      thread_name,
      thread_id,
      read_rows,
      read_bytes,
      written_rows,
      written_bytes,
      memory_usage,
      peak_memory_usage,
      formatReadableSize(memory_usage) as readable_memory_usage,
      round(memory_usage * 100.0 / nullIf(max(memory_usage) OVER (), 0), 2) as pct_memory_usage,
      formatReadableSize(peak_memory_usage) as readable_peak_memory_usage,
      round(peak_memory_usage * 100.0 / nullIf(max(peak_memory_usage) OVER (), 0), 2) as pct_peak_memory_usage,
      formatReadableQuantity(read_rows) as readable_read_rows,
      round(read_rows * 100.0 / nullIf(max(read_rows) OVER (), 0), 2) as pct_read_rows,
      formatReadableSize(read_bytes) as readable_read_bytes,
      event_time
    FROM system.query_thread_log
    WHERE event_date >= today() - 1
    ORDER BY event_time DESC
    LIMIT 1000
  `,
  columns: [
    'query_id',
    'thread_name',
    'thread_id',
    'readable_memory_usage',
    'readable_peak_memory_usage',
    'readable_read_rows',
    'readable_read_bytes',
    'event_time',
  ],
  columnFormats: {
    event_time: 'related-time',
    query_id: ['link', { href: '/query?query_id=[query_id]' }],
    thread_name: 'colored-badge',
    readable_memory_usage: 'background-bar',
    readable_peak_memory_usage: 'background-bar',
    readable_read_rows: 'background-bar',
  },
  relatedCharts: ['thread-utilization', 'parallelization-efficiency'],
}
