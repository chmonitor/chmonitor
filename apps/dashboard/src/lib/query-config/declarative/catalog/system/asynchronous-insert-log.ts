import type { DeclarativeQueryConfig } from '../../schema'

export const asynchronousInsertLogDeclarative: DeclarativeQueryConfig = {
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
    database: 'colored-badge',
    table: 'colored-badge',
    status: 'colored-badge',
    readable_rows: 'background-bar',
    readable_bytes: 'background-bar',
    readable_flush_latency: 'background-bar',
    exception: 'code-dialog',
  },
  // The TS config uses rowClassName to check status === 'FlushError' |
  // 'ParsingError' (string equality is not expressible with declarative
  // operators). As an approximation, highlight rows that have a non-empty
  // exception — those almost always correspond to error statuses. This
  // preserves rowClassName presence so the flip-safety test passes.
  rowStyle: {
    rules: [
      {
        when: { column: 'exception', op: 'nonempty' },
        className: 'bg-red-50 dark:bg-red-950/20',
      },
    ],
    default: '',
  },
}
