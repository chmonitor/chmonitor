import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const parallelizationConfig: QueryConfig = {
  name: 'parallelization',
  defaultView: 'auto',
  card: { primary: 'query_id' },
  description: 'Query parallelization efficiency analysis',
  optional: true,
  tableCheck: 'system.query_thread_log',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_thread_log',
  sql: `
    SELECT
      query_id,
      count() as thread_count,
      sum(read_rows) as total_read_rows,
      sum(read_bytes) as total_read_bytes,
      max(peak_memory_usage) as max_peak_memory,
      sum(memory_usage) as total_memory,
      formatReadableQuantity(total_read_rows) as readable_total_read_rows,
      round(total_read_rows * 100.0 / nullIf(max(total_read_rows) OVER (), 0), 2) as pct_total_read_rows,
      formatReadableSize(total_read_bytes) as readable_total_read_bytes,
      round(total_read_bytes * 100.0 / nullIf(max(total_read_bytes) OVER (), 0), 2) as pct_total_read_bytes,
      formatReadableSize(max_peak_memory) as readable_max_peak_memory,
      round(max_peak_memory * 100.0 / nullIf(max(max_peak_memory) OVER (), 0), 2) as pct_max_peak_memory,
      formatReadableSize(total_memory) as readable_total_memory,
      min(event_time) as event_time
    FROM system.query_thread_log
    WHERE event_date >= today() - 1
    GROUP BY query_id
    ORDER BY thread_count DESC
    LIMIT 500
  `,
  columns: [
    'query_id',
    'thread_count',
    'readable_total_read_rows',
    'readable_total_read_bytes',
    'readable_max_peak_memory',
    'readable_total_memory',
    'event_time',
  ],
  columnFormats: {
    event_time: ColumnFormat.RelatedTime,
    query_id: [ColumnFormat.Link, { href: '/query?query_id=[query_id]' }],
    thread_count: ColumnFormat.Number,
    readable_total_read_rows: ColumnFormat.BackgroundBar,
    readable_total_read_bytes: ColumnFormat.BackgroundBar,
    readable_max_peak_memory: ColumnFormat.BackgroundBar,
  },
  relatedCharts: ['parallelization-efficiency', 'thread-utilization'],
}
