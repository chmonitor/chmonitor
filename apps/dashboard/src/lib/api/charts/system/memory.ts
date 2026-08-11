/**
 * Memory usage and RSS-breakdown charts.
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

export const memoryCharts: Record<string, ChartQueryBuilder> = {
  'memory-usage': ({ interval = 'toStartOfTenMinutes', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           avg(CurrentMetric_MemoryTracking) AS avg_memory,
           formatReadableSize(avg_memory) AS readable_avg_memory
    FROM merge('system', '^metric_log')
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  'memory-breakdown': ({
    interval = 'toStartOfTenMinutes',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      ${applyInterval(interval, 'event_time')},
      ifNotFinite(avgIf(value, metric = 'CurrentMetric_MemoryTracking'), 0) AS total_memory,
      ifNotFinite(avgIf(value, metric = 'CurrentMetric_MergesMutationsMemoryTracking'), 0) AS merges_memory,
      ifNotFinite(avgIf(value, metric = 'MarkCacheBytes'), 0)
        + ifNotFinite(avgIf(value, metric = 'UncompressedCacheBytes'), 0)
        + ifNotFinite(avgIf(value, metric = 'QueryCacheBytes'), 0) AS caches_memory,
      greatest(total_memory - merges_memory - caches_memory, 0) AS queries_memory,
      any((SELECT sum(primary_key_bytes_in_memory) FROM system.parts WHERE active)) AS primary_key_memory
    FROM merge('system', '^asynchronous_metric_log')
    WHERE metric IN (
      'CurrentMetric_MemoryTracking',
      'CurrentMetric_MergesMutationsMemoryTracking',
      'MarkCacheBytes',
      'UncompressedCacheBytes',
      'QueryCacheBytes'
    )
    ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1 ASC`,
      optional: true,
      tableCheck: 'system.asynchronous_metric_log',
      permission: METRICS_PERMISSION,
    }
  },

  // Load average (1m/5m/15m) vs core count. Core count is derived (not a
  // single dedicated async metric) by counting the distinct per-core
  // `OSUserTimeCPU{N}` gauges ClickHouse emits — one per logical core.
}
