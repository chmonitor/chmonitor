import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

export const logsCharts: Record<string, ChartQueryBuilder> = {
  'log-level-distribution': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT level,
               count() as count
        FROM system.text_log
        WHERE event_date >= today()
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY level
        ORDER BY count DESC
      `,
      optional: true,
      tableCheck: 'system.text_log',
    }
  },

  'error-rate-over-time': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT ${applyInterval(interval, 'event_time')},
               countIf(level = 'Error') as error_count,
               countIf(level = 'Warning') as warning_count,
               countIf(level = 'Information') as info_count
        FROM system.text_log
        WHERE 1=1
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY event_time
        ORDER BY event_time
        WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
      `,
      optional: true,
      tableCheck: 'system.text_log',
    }
  },

  'crash-frequency': ({ interval = 'toStartOfDay', lastHours = 24 * 30 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT ${applyInterval(interval, 'event_time')},
               count() as crash_count,
               groupUniqArray(signal) as signals
        FROM system.crash_log
        WHERE 1=1
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY event_time
        ORDER BY event_time
      `,
      optional: true,
      tableCheck: 'system.crash_log',
    }
  },

  'log-count-today': () => ({
    query: `
      SELECT count() as count
      FROM system.text_log
      WHERE event_date = today()
    `,
    optional: true,
    tableCheck: 'system.text_log',
  }),
}
