/**
 * Chart Type Hints
 *
 * Defines the skeleton type for each registered chart.
 * Used by ChartSkeleton to display appropriate loading state.
 */

import type { ChartSkeletonType } from './types'

/**
 * Chart type hints mapping
 * Maps each chart name to its appropriate skeleton type
 */
export const CHART_TYPE_HINTS: Record<string, ChartSkeletonType> = {
  // Query Charts - mostly area/line charts
  'query-count': 'area',
  'query-count-by-user': 'bar',
  'query-duration': 'area',
  'query-memory': 'area',
  'query-metric-log-memory': 'area',
  'query-type': 'bar',
  'failed-query-count': 'area',
  'failed-query-count-by-user': 'bar',
  'query-cache': 'metric',
  'query-cache-usage': 'bar',
  'query-duration-percentiles': 'area',
  'slow-query-occurrences': 'bar',

  // Query Insights overview (parity with ClickHouse Cloud Query Insights)
  'query-insights-qps': 'area',
  'query-insights-latency': 'area',
  'query-insights-operations': 'bar',
  'query-insights-rows': 'area',
  'query-insights-cache-hit-ratio': 'bar',
  'query-insights-errors': 'area',
  'query-insights-memory': 'area',
  'query-insights-read-throughput': 'area',
  'query-insights-top-users': 'bar',

  // Merge Charts - area and metric
  'merge-count': 'area',
  'summary-used-by-merges': 'table',
  'merge-avg-duration': 'area',
  'merge-sum-read-rows': 'area',
  'new-parts-created': 'area',

  // Mutation Charts
  'summary-used-by-mutations': 'table',
  'summary-stuck-mutations': 'metric',

  // Running Queries Charts
  'summary-used-by-running-queries': 'table',

  // System Charts - mixed types
  'disk-size': 'metric',
  'disks-usage': 'area',
  'backup-size': 'metric',
  'memory-usage': 'area',
  'cpu-usage': 'area',
  'disk-usage-by-database': 'bar',
  'memory-breakdown': 'area',
  'cpu-load-average': 'area',
  'cpu-mode-split': 'area',
  'thread-pool-utilization': 'area',

  // Replication Charts
  'replication-queue-count': 'area',
  'replication-summary-table': 'table',
  'readonly-replica': 'area',

  // Connection Charts
  'connections-interserver': 'metric',
  'connections-http': 'metric',
  'connections-pool': 'area',

  // Table Charts
  'top-table-size': 'bar',
  'parts-per-table': 'bar',

  // Page Views Charts
  'page-view': 'bar',
  'top-pages': 'bar',
  'human-vs-bot-pageviews': 'area',
  'pageviews-by-device': 'bar',
  'pageviews-by-country': 'bar',

  // ZooKeeper Charts
  'zookeeper-summary-table': 'table',
  'zookeeper-uptime': 'metric',
  'zookeeper-requests': 'area',
  'zookeeper-wait': 'area',
  'zookeeper-exception': 'area',
}

/**
 * Get chart skeleton type for a given chart name
 * Returns 'area' as default if chart type is not defined
 */
export function getChartSkeletonType(chartName: string): ChartSkeletonType {
  return CHART_TYPE_HINTS[chartName] || 'area'
}
