/**
 * Connection Charts
 * Charts for tracking HTTP and inter-server connections
 */

import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter } from './types'

export const connectionCharts: Record<string, ChartQueryBuilder> = {
  'connections-http': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const httpSql = (httpConnectionsTotal: string) => `
    /* HTTPConnection: Number of connections to HTTP server */
    /* HTTPConnectionsTotal: Total count of all sessions: stored in the pool and actively used right now for http hosts */

    SELECT
      ${applyInterval(interval, 'event_time')},
      SUM(CurrentMetric_HTTPConnection) AS CurrentMetric_HTTPConnection,
      formatReadableQuantity(CurrentMetric_HTTPConnection) AS readable_CurrentMetric_HTTPConnection,
      ${httpConnectionsTotal} AS CurrentMetric_HTTPConnectionsTotal,
      formatReadableQuantity(CurrentMetric_HTTPConnectionsTotal) AS readable_CurrentMetric_HTTPConnectionsTotal
    FROM system.metric_log
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `
    // CurrentMetric_HTTPConnectionsTotal is not in 23.x metric_log; below
    // 24.3 that series is 0 so the stacked chart shows HTTPConnection only.
    const legacySql = httpSql('toUInt64(0)')
    return {
      query: legacySql,
      sql: [
        { since: '1.0', sql: legacySql },
        {
          since: '24.3',
          sql: httpSql('SUM(CurrentMetric_HTTPConnectionsTotal)'),
        },
      ],
    }
  },

  'connections-interserver': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      SUM(CurrentMetric_InterserverConnection) AS CurrentMetric_InterserverConnection,
      formatReadableQuantity(CurrentMetric_InterserverConnection) AS readable_CurrentMetric_InterserverConnection
    FROM system.metric_log
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `,
    }
  },

  'connections-pool': ({
    interval = 'toStartOfFiveMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        SUM(CurrentMetric_TCPConnection) AS TCPConnection,
        SUM(CurrentMetric_HTTPConnection) AS HTTPConnection,
        SUM(CurrentMetric_InterserverConnection) AS InterserverConnection
      FROM system.metric_log
      ${timeFilter ? `WHERE ${timeFilter}` : ''}
      GROUP BY event_time
      ORDER BY event_time
    `,
    }
  },
}
