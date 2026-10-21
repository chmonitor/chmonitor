import type { DeclarativeQueryConfig } from '../../schema'

export const backgroundSchedulePoolLogDeclarative: DeclarativeQueryConfig = {
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
    database: 'colored-badge',
    table: 'colored-badge',
    log_name: 'colored-badge',
    readable_duration: 'background-bar',
    exception: 'code-dialog',
  },
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
