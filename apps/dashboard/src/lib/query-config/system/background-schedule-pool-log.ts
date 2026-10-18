import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const backgroundSchedulePoolLogConfig: QueryConfig = {
  name: 'background-schedule-pool-log',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['log_name', 'exception'] },
  description:
    'Background schedule pool task history: durations, failures, and exceptions (system.background_schedule_pool_log, CH 25.12+)',
  refreshInterval: 30_000,
  optional: true,
  tableCheck: 'system.background_schedule_pool_log',
  sql: [
    {
      since: '25.12',
      description: 'Background schedule pool task execution history',
      sql: `
        SELECT
          event_time,
          database,
          table,
          log_name,
          duration_ms,
          formatReadableTimeDelta(duration_ms / 1000) AS readable_duration,
          round(duration_ms * 100.0 / nullIf(max(duration_ms) OVER (), 0), 2) AS pct_duration,
          exception
        FROM system.background_schedule_pool_log
        ORDER BY event_time DESC
        LIMIT 1000
      `,
    },
  ],
  columns: [
    'event_time',
    'database',
    'table',
    'log_name',
    'readable_duration',
    'exception',
  ],
  columnFormats: {
    database: ColumnFormat.ColoredBadge,
    table: ColumnFormat.ColoredBadge,
    log_name: ColumnFormat.ColoredBadge,
    readable_duration: ColumnFormat.BackgroundBar,
    exception: ColumnFormat.CodeDialog,
  },
  rowClassName: (row) => {
    const exception = String(row.exception || '')
    if (exception !== '') return 'bg-red-50 dark:bg-red-950/20'
    return ''
  },
}
