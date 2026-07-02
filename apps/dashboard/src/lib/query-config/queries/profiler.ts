import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const profilerConfig: QueryConfig = {
  name: 'profiler',
  defaultView: 'auto',
  card: { primary: 'processor_name' },
  description: 'Query processor profiling data',
  optional: true,
  tableCheck: 'system.processors_profile_log',
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/processors_profile_log',
  sql: `
    SELECT
      query_id,
      name as processor_name,
      elapsed_us,
      input_wait_elapsed_us,
      output_wait_elapsed_us,
      input_rows,
      input_bytes,
      output_rows,
      output_bytes,
      formatReadableQuantity(input_rows) as readable_input_rows,
      round(input_rows * 100.0 / nullIf(max(input_rows) OVER (), 0), 2) as pct_input_rows,
      formatReadableSize(input_bytes) as readable_input_bytes,
      formatReadableQuantity(output_rows) as readable_output_rows,
      round(output_rows * 100.0 / nullIf(max(output_rows) OVER (), 0), 2) as pct_output_rows,
      formatReadableSize(output_bytes) as readable_output_bytes,
      round(elapsed_us / 1000, 2) as elapsed_ms,
      event_time
    FROM system.processors_profile_log
    WHERE event_date >= today() - 1
    ORDER BY elapsed_us DESC
    LIMIT 1000
  `,
  columns: [
    'query_id',
    'processor_name',
    'elapsed_ms',
    'readable_input_rows',
    'readable_input_bytes',
    'readable_output_rows',
    'readable_output_bytes',
    'event_time',
  ],
  columnFormats: {
    event_time: ColumnFormat.RelatedTime,
    query_id: [ColumnFormat.Link, { href: '/query?query_id=[query_id]' }],
    processor_name: ColumnFormat.ColoredBadge,
    elapsed_ms: ColumnFormat.Number,
    readable_input_rows: ColumnFormat.BackgroundBar,
    readable_output_rows: ColumnFormat.BackgroundBar,
  },
  relatedCharts: ['thread-utilization'],
}
