/**
 * ClickHouse Keeper (ZooKeeper) request/wait charts.
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import {
  applyInterval,
  buildTimeFilter,
  buildTimeFilterInterval,
  type ChartQueryBuilder,
} from '../types'

export const keeperCharts: Record<string, ChartQueryBuilder> = {
  'keeper-requests': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilterInterval(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        avg(value) AS avg_value,
        metric
      FROM merge('system', '^asynchronous_metric_log')
      WHERE metric IN ('ZooKeeperRequest', 'ZooKeeperWatch', 'ZooKeeperSession')
        ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY 1, metric
      ORDER BY 1 ASC
    `,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
    }
  },

  'keeper-wait-time': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
      SELECT
        ${applyInterval(interval, 'event_time')},
        sum(ProfileEvent_ZooKeeperWaitMicroseconds) / 1000 AS wait_ms
      FROM merge('system', '^metric_log')
      ${timeFilter ? `WHERE ${timeFilter}` : ''}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
      optional: true,
      tableCheck: 'system.metric_log',
    }
  },
}
