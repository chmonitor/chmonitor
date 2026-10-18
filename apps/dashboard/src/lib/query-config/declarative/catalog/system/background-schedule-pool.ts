import type { DeclarativeQueryConfig } from '../../schema'

export const backgroundSchedulePoolDeclarative: DeclarativeQueryConfig = {
  name: 'background-schedule-pool',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['pool', 'state'] },
  description:
    'Live background scheduled tasks: active and pending jobs in the background schedule pool (system.background_schedule_pool, CH 25.12+)',
  refreshInterval: 10_000,
  optional: true,
  tableCheck: 'system.background_schedule_pool',
  sql: [
    {
      since: '25.12',
      description: 'Background schedule pool live task state',
      sql: `
        SELECT
          pool,
          database,
          table,
          log_name,
          multiIf(executing, 'executing', delayed, 'delayed', scheduled, 'scheduled', 'idle') AS state,
          deactivated,
          elapsed_ms,
          formatReadableTimeDelta(elapsed_ms / 1000) AS readable_elapsed,
          round(elapsed_ms * 100.0 / nullIf(max(elapsed_ms) OVER (), 0), 2) AS pct_elapsed
        FROM system.background_schedule_pool
        ORDER BY elapsed_ms DESC
      `,
    },
  ],
  columns: [
    'pool',
    'database',
    'table',
    'log_name',
    'state',
    'readable_elapsed',
  ],
  columnFormats: {
    pool: 'colored-badge',
    database: 'colored-badge',
    table: 'colored-badge',
    state: 'colored-badge',
    readable_elapsed: 'background-bar',
  },
}
