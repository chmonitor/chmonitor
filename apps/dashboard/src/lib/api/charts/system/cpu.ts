/**
 * CPU usage, load average, and mode-split charts.
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import {
  applyInterval,
  buildTimeFilter,
  type ChartQueryBuilder,
} from '../types'
import { METRICS_PERMISSION } from './permissions'

export const cpuCharts: Record<string, ChartQueryBuilder> = {
  'cpu-usage': ({ interval = 'toStartOfTenMinutes', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
       ${applyInterval(interval, 'event_time')},
       avg(ProfileEvent_OSCPUVirtualTimeMicroseconds) / 1000000 as avg_cpu
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1`,
      optional: true,
      tableCheck: 'system.metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // Memory breakdown (RSS decomposition): approximates where the root memory
  // tracker's bytes are going by subtracting the two biggest known background
  // consumers (mark/uncompressed/query caches, background merges/mutations)
  // from the total tracked memory; the remainder is attributed to
  // queries/other. Primary-key/index memory has no historical time series in
  // ClickHouse (system.parts is a live snapshot only), so it rides along as a
  // constant "current" value repeated across every bucket via a scalar
  // subquery wrapped in any() (required so it's valid alongside the GROUP BY).
  // Row-based (metric, value) source ⇒ a metric name absent on an older
  // ClickHouse version just yields no matching rows (ifNotFinite guards the
  // resulting NaN from an empty avgIf) instead of a SQL error, so this needs
  // no per-column `sql: VersionedSql[]` branching — only the table-existence
  // check below.
  'cpu-load-average': ({
    interval = 'toStartOfTenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      ifNotFinite(avgIf(value, metric = 'LoadAverage1'), 0) AS load_average_1m,
      ifNotFinite(avgIf(value, metric = 'LoadAverage5'), 0) AS load_average_5m,
      ifNotFinite(avgIf(value, metric = 'LoadAverage15'), 0) AS load_average_15m,
      uniqExactIf(metric, metric LIKE 'OSUserTimeCPU%') AS cpu_cores
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN ('LoadAverage1', 'LoadAverage5', 'LoadAverage15')
       OR metric LIKE 'OSUserTimeCPU%'
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // CPU mode split (user/system/iowait/idle), aggregated across all cores.
  // Degrades gracefully (all-zero series → chart empty state) on platforms
  // that don't expose these OS-level asynchronous metrics.
  'cpu-mode-split': ({ interval = 'toStartOfTenMinutes', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      ifNotFinite(avgIf(value, metric = 'OSUserTime'), 0) AS user_time,
      ifNotFinite(avgIf(value, metric = 'OSSystemTime'), 0) AS system_time,
      ifNotFinite(avgIf(value, metric = 'OSIOWaitTime'), 0) AS iowait_time,
      ifNotFinite(avgIf(value, metric = 'OSIdleTime'), 0) AS idle_time
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN ('OSUserTime', 'OSSystemTime', 'OSIOWaitTime', 'OSIdleTime')
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // Global thread pool saturation (active vs total threads). Uses
  // `system.metric_log`'s CurrentMetric_* columns, same source/convention as
  // 'memory-usage'/'cpu-usage' above.
  'thread-pool-utilization': ({
    interval = 'toStartOfTenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      avg(CurrentMetric_GlobalThreadPoolActiveThreads) AS active_threads,
      avg(CurrentMetric_GlobalThreadPoolThreads) AS total_threads
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.metric_log',
      permission: METRICS_PERMISSION,
    }
  },
}
