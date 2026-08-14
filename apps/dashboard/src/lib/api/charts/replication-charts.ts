/**
 * Replication Charts
 * Charts for tracking ClickHouse replication status and queue
 */

import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter } from './types'

export const replicationCharts: Record<string, ChartQueryBuilder> = {
  'replication-queue-count': () => ({
    query: `
    SELECT COUNT() as count_all,
           countIf(is_currently_executing) AS count_executing
    FROM system.replication_queue
  `,
  }),

  'replication-summary-table': () => ({
    query: `
    SELECT (database || '.' || table) as table,
           type,
           countIf(is_currently_executing) AS current_executing,
           COUNT() as total
    FROM system.replication_queue
    GROUP BY 1, 2
    ORDER BY total DESC
  `,
  }),

  'readonly-replica': ({
    interval = 'toStartOfFifteenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           MAX(CurrentMetric_ReadonlyReplica) AS ReadonlyReplica
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `,
    }
  },

  'replication-lag': () => ({
    query: `
    SELECT
      database,
      table,
      replica_name,
      absolute_delay,
      CASE
        WHEN absolute_delay = 0 THEN 'synced'
        WHEN absolute_delay < 60 THEN 'slight lag'
        WHEN absolute_delay < 300 THEN 'moderate lag'
        ELSE 'severe lag'
      END AS lag_status,
      formatReadableTimeDelta(absolute_delay) AS readable_delay,
      inserts_in_queue,
      merges_in_queue,
      -- Per-replica health score (0-100): base from lag tier, -5 per 100 queue items
      greatest(0, least(100,
        multiIf(
          absolute_delay = 0, 100,
          absolute_delay < 60, 75,
          absolute_delay < 300, 50,
          0
        ) - intDiv(inserts_in_queue + merges_in_queue, 100) * 5
      )) AS health_score
    FROM system.replicas
    WHERE is_leader = 1 OR absolute_delay > 0
    ORDER BY absolute_delay DESC
    LIMIT 20
  `,
  }),

  /**
   * Replication lag trend — time-series of max and avg lag from metric_log.
   * Used by the lag trend chart added in #1914.
   */
  'replication-lag-trend': ({
    interval = 'toStartOfFiveMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      max(CurrentMetric_ReplicasMaxAbsoluteDelay) AS max_lag_seconds,
      avg(CurrentMetric_ReplicasMaxAbsoluteDelay) AS avg_lag_seconds
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `,
      optional: true,
      tableCheck: 'system.metric_log',
      columnCheck: 'system.metric_log.CurrentMetric_ReplicasMaxAbsoluteDelay',
    }
  },
}
