import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const asynchronousInsertLogConfig: QueryConfig = {
  name: 'asynchronous-insert-log',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['database', 'table', 'status'] },
  description:
    'Async insert flush history: latency, rows/bytes per flush, status (Ok/FlushError/ParsingError), and exception drill-down (system.asynchronous_insert_log)',
  refreshInterval: 30_000,
  optional: true,
  tableCheck: 'system.asynchronous_insert_log',
  sql: `
    SELECT
      event_time,
      query_id,
      database,
      table,
      format,
      status,
      rows,
      formatReadableQuantity(rows) AS readable_rows,
      round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
      bytes,
      formatReadableSize(bytes) AS readable_bytes,
      round(bytes * 100.0 / nullIf(max(bytes) OVER (), 0), 2) AS pct_bytes,
      dateDiff('microsecond', event_time_microseconds, flush_time_microseconds) AS flush_latency_microseconds,
      formatReadableTimeDelta(flush_latency_microseconds / 1000000, 'hours', 'milliseconds') AS readable_flush_latency,
      round(flush_latency_microseconds * 100.0 / nullIf(max(flush_latency_microseconds) OVER (), 0), 2) AS pct_flush_latency,
      exception
    FROM system.asynchronous_insert_log
    ORDER BY event_time DESC
    LIMIT 1000
  `,
  columns: [
    'event_time',
    'database',
    'table',
    'format',
    'status',
    'readable_rows',
    'readable_bytes',
    'readable_flush_latency',
    'exception',
  ],
  columnFormats: {
    database: ColumnFormat.ColoredBadge,
    table: ColumnFormat.ColoredBadge,
    status: ColumnFormat.ColoredBadge,
    readable_rows: ColumnFormat.BackgroundBar,
    readable_bytes: ColumnFormat.BackgroundBar,
    readable_flush_latency: ColumnFormat.BackgroundBar,
    exception: ColumnFormat.CodeDialog,
  },
  rowClassName: (row) => {
    const status = String(row.status || '')
    if (status === 'FlushError' || status === 'ParsingError')
      return 'bg-red-50 dark:bg-red-950/20'
    return ''
  },
}
