/**
 * Per-chart poll interval + HTTP cache policy.
 *
 * Factory charts default to 60s / `standard` (30s s-maxage). That is the
 * right bucket for live metric series (CPU, memory, connection pool). It is
 * the wrong bucket for day-granularity heatmaps, storage snapshots, and
 * long-window query_log aggregates — those change on a merge / hour / day
 * timescale, not every 30–60s.
 *
 * Only charts whose volatility was audited live here. Omitted charts keep
 * the factory default. Live process/metrics tiles stay fast (`realtime`).
 *
 * See #2992 (refresh intervals) and #3005 item 3 (`cachePolicy`).
 */

import type { CachePolicy } from '@/types/chart-data'

import { REFRESH_INTERVAL, type RefreshInterval } from './config'

export type ChartFreshness = {
  refreshInterval: RefreshInterval
  cachePolicy: CachePolicy
}

export const CHART_FRESHNESS = {
  // --- Live process / metrics tiles (keep fast) ---
  'running-queries-count': {
    refreshInterval: REFRESH_INTERVAL.FAST_15S,
    cachePolicy: 'realtime',
  },
  'merge-active-count': {
    refreshInterval: REFRESH_INTERVAL.FAST_15S,
    cachePolicy: 'realtime',
  },
  'insight-active-queries': {
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
    cachePolicy: 'realtime',
  },
  'insight-current-memory': {
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
    cachePolicy: 'realtime',
  },
  'insight-http-connections': {
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
    cachePolicy: 'realtime',
  },
  'insight-active-merges': {
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
    cachePolicy: 'realtime',
  },
  'insight-active-mutations': {
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
    cachePolicy: 'realtime',
  },

  // --- Day-granularity / multi-year historical ---
  'query-count-heatmap': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'query-duration': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'query-memory': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'disks-usage': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'disk-usage-trend': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'backup-size': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-busiest-day-queries': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-busiest-day-bytes': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },

  // --- Storage snapshots (parts / disks / table sizes) ---
  'top-table-size': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'disk-size': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'disk-size-single': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'disk-size-all': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'disk-usage-by-database': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'parts-per-table': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'partition-part-health': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'partition-part-health-summary': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'data-freshness': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'database-count': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'table-count': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-total-storage': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-top-tables-by-size': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-compression-ratios': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-active-parts': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },
  'insight-detached-parts': {
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
    cachePolicy: 'historical',
  },

  // --- Hourly / long-window query_log and metric_log aggregates ---
  'query-count': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'query-count-today': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'query-count-by-user': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'query-duration-percentiles': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'query-duration-trend': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'failed-query-count': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'new-parts-created': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'merge-count': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'disk-io-throughput': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'thread-utilization': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'top-memory-queries': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'top-inserters': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'top-query-fingerprints': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'top-query-fingerprints-perf': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-largest-scan': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-fastest-scan': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-longest-query': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-query-summary': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-total-queries': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-total-scanned': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-total-rows-read': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-peak-memory': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-avg-duration': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-error-rate': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
  'insight-busiest-second': {
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    cachePolicy: 'historical',
  },
} as const satisfies Record<string, ChartFreshness>

export type FreshnessChartName = keyof typeof CHART_FRESHNESS

export function chartRefreshInterval(
  chartName: string
): RefreshInterval | undefined {
  return CHART_FRESHNESS[chartName as FreshnessChartName]?.refreshInterval
}

export function chartCachePolicy(chartName: string): CachePolicy | undefined {
  return CHART_FRESHNESS[chartName as FreshnessChartName]?.cachePolicy
}
