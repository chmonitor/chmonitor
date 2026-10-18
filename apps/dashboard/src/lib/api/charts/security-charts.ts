import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

export const securityCharts: Record<string, ChartQueryBuilder> = {
  'login-success-rate': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT ${applyInterval(interval, 'event_time')},
               countIf(type = 'LoginSuccess') as success_count,
               countIf(type = 'LoginFailure') as failure_count,
               round(100 * success_count / (success_count + failure_count), 2) as success_rate
        FROM system.session_log
        WHERE type IN ('LoginSuccess', 'LoginFailure')
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY event_time
        ORDER BY event_time
        WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
      `,
      optional: true,
      tableCheck: 'system.session_log',
    }
  },

  'failed-login-by-user': ({ lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT user,
               count() as failure_count,
               groupArray(client_address) as client_addresses
        FROM system.session_log
        WHERE type = 'LoginFailure'
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY user
        ORDER BY failure_count DESC
        LIMIT 10
      `,
      optional: true,
      tableCheck: 'system.session_log',
    }
  },

  'active-sessions-count': () => ({
    query: `
      SELECT count() as active_count,
             countDistinct(user) as unique_users
      FROM (
        SELECT session_id,
               user,
               argMax(type, event_time) as last_type
        FROM system.session_log
        WHERE event_time >= now() - INTERVAL 1 HOUR
        GROUP BY session_id, user
      )
      WHERE last_type = 'LoginSuccess'
    `,
    optional: true,
    tableCheck: 'system.session_log',
  }),

  'sessions-by-auth-type': ({ lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT auth_type,
               count() as session_count,
               round(100 * session_count / sum(session_count) OVER (), 2) as percentage
        FROM system.session_log
        WHERE type = 'LoginSuccess'
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY auth_type
        ORDER BY session_count DESC
      `,
      optional: true,
      tableCheck: 'system.session_log',
    }
  },

  'sessions-by-interface': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
        SELECT ${applyInterval(interval, 'event_time')},
               interface,
               count() as session_count
        FROM system.session_log
        WHERE type = 'LoginSuccess'
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY event_time, interface
        ORDER BY event_time ASC, session_count DESC
      `,
      optional: true,
      tableCheck: 'system.session_log',
    }
  },
}
