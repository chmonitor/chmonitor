import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep } from './types'

export const zookeeperCharts: Record<string, ChartQueryBuilder> = {
  'zookeeper-requests': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      SUM(CurrentMetric_ZooKeeperRequest) AS ZookeeperRequests,
      formatReadableQuantity(ZookeeperRequests) AS readable_ZookeeperRequests,
      SUM(CurrentMetric_ZooKeeperWatch) AS ZooKeeperWatch,
      formatReadableQuantity(ZooKeeperWatch) AS readable_ZooKeeperWatch
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `,
    }
  },

  'zookeeper-exception': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      sum(value) AS KEEPER_EXCEPTION
    FROM merge('system', '^error_log')
    WHERE error = 'KEEPER_EXCEPTION'
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time WITH FILL TO now() STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.error_log',
    }
  },

  'zookeeper-uptime': () => ({
    query: 'SELECT formatReadableTimeDelta(zookeeperSessionUptime()) AS uptime',
  }),

  'zookeeper-wait': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      AVG(ProfileEvent_ZooKeeperWaitMicroseconds) / 1000000 AS AVG_ProfileEvent_ZooKeeperWaitSeconds,
      formatReadableTimeDelta(AVG_ProfileEvent_ZooKeeperWaitSeconds) AS readable_AVG_ProfileEvent_ZooKeeperWaitSeconds
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `,
    }
  },

  'zookeeper-summary-table': () => ({
    query: `
    SELECT metric, value, description
    FROM system.metrics
    WHERE metric LIKE 'ZooKeeper%'
  `,
  }),

  // Single-row, real-time Keeper health snapshot from system.metrics. Metrics
  // compiled into the build are listed (value 0 when unused), so missing-metric
  // subqueries resolve to 0 rather than erroring. `outstanding_requests` matches
  // both spellings because the metric was renamed from the misspelled
  // 'KeeperOutstandingRequets' to 'KeeperOutstandingRequests' in v24.8
  // (PR #66206); summing over an IN-set works on the whole v23.3->v26 range.
  // Consumed by the Keeper Overview KPI cards (not rendered as a standalone chart).
  'keeper-health': () => ({
    query: `
    SELECT
      (SELECT toUInt64(value) FROM system.metrics WHERE metric = 'KeeperAliveConnections') AS alive_connections,
      (SELECT toUInt64(sum(value)) FROM system.metrics WHERE metric IN ('KeeperOutstandingRequests', 'KeeperOutstandingRequets')) AS outstanding_requests,
      (SELECT toUInt64(value) FROM system.metrics WHERE metric = 'ZooKeeperSession') AS sessions,
      (SELECT toUInt64(value) FROM system.metrics WHERE metric = 'ZooKeeperWatch') AS watches,
      (SELECT toUInt64(value) FROM system.metrics WHERE metric = 'ZooKeeperRequest') AS in_flight_requests,
      (SELECT toUInt64(value) FROM system.metrics WHERE metric = 'ZooKeeperSessionExpired') AS session_expired,
      (SELECT toUInt64(value) FROM system.metrics WHERE metric = 'ZooKeeperConnectionLossStartedTimestampSeconds') AS connection_loss_ts
  `,
  }),

  // Single-row consistency/cluster-state summary aggregated across all Keeper
  // nodes. Optional: system.zookeeper_info only exists on recent ClickHouse
  // releases with Keeper/ZooKeeper configured.
  'keeper-info-summary': () => ({
    query: `
    SELECT
      count() AS nodes,
      countIf(is_leader = 1) AS leaders,
      any(server_state) AS server_state,
      max(toInt64(last_log_idx) - toInt64(last_committed_idx)) AS max_log_lag,
      sum(followers) AS followers,
      sum(synced_followers) AS synced_followers,
      max(znode_count) AS znode_count,
      max(watch_count) AS watch_count,
      max(ephemerals_count) AS ephemerals_count,
      max(approximate_data_size) AS data_size,
      formatReadableSize(max(approximate_data_size)) AS readable_data_size,
      round(avg(avg_latency), 2) AS avg_latency_ms
    FROM system.zookeeper_info
  `,
    optional: true,
    tableCheck: 'system.zookeeper_info',
  }),

  'keeper-operation-mix': () => ({
    query: `
    SELECT
      replaceOne(event, 'ZooKeeper', '') AS operation,
      value AS count,
      formatReadableQuantity(value) AS readable_count
    FROM system.events
    WHERE event IN (
      'ZooKeeperGet', 'ZooKeeperList', 'ZooKeeperCreate', 'ZooKeeperRemove',
      'ZooKeeperSet', 'ZooKeeperExists', 'ZooKeeperMulti', 'ZooKeeperMultiRead',
      'ZooKeeperMultiWrite', 'ZooKeeperWatchResponse'
    )
      AND value > 0
    ORDER BY count DESC
  `,
  }),

  'keeper-bytes': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      sum(ProfileEvent_ZooKeeperBytesSent) AS bytes_sent,
      sum(ProfileEvent_ZooKeeperBytesReceived) AS bytes_received
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time
  `,
    }
  },

  // Keeper connect/disconnect events over time — reconnect spikes indicate
  // session instability. Optional: system.zookeeper_connection_log is recent.
  'keeper-connection-events': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      countIf(type = 'Connected') AS connected,
      countIf(type = 'Disconnected') AS disconnected
    FROM system.zookeeper_connection_log
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time WITH FILL STEP ${fillStep(interval)}
  `,
      optional: true,
      tableCheck: 'system.zookeeper_connection_log',
    }
  },
}
