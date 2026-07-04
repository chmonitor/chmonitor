/**
 * Chart Categories
 *
 * Chart category constants for organizing and grouping charts.
 */

/**
 * Chart category identifiers
 */
export const CHART_CATEGORIES = {
  QUERY: 'query',
  MERGE: 'merge',
  SYSTEM: 'system',
  REPLICATION: 'replication',
  ZOOKEEPER: 'zookeeper',
  FACTORY: 'factory',
  PRIMITIVES: 'primitives',
  CONNECTION: 'connection',
  TABLE: 'table',
  PAGE_VIEW: 'page-view',
} as const

/**
 * Chart category type
 */
export type ChartCategory =
  (typeof CHART_CATEGORIES)[keyof typeof CHART_CATEGORIES]

/**
 * Charts organized by category
 */
export const CHARTS_BY_CATEGORY: Record<ChartCategory, string[]> = {
  [CHART_CATEGORIES.QUERY]: [
    'query-count',
    'query-count-by-user',
    'query-duration',
    'query-memory',
    'query-metric-log-memory',
    'query-type',
    'failed-query-count',
    'failed-query-count-by-user',
    'query-cache',
    'query-cache-usage',
    'top-query-fingerprints',
    'cancelled-queries',
    'query-duration-percentiles',
    'slow-query-occurrences',
  ],
  [CHART_CATEGORIES.MERGE]: [
    'merge-count',
    'summary-used-by-merges',
    'merge-avg-duration',
    'merge-sum-read-rows',
    'new-parts-created',
    'summary-used-by-mutations',
    'summary-stuck-mutations',
  ],
  [CHART_CATEGORIES.SYSTEM]: [
    'summary-used-by-running-queries',
    'disk-size',
    'disk-usage-trend',
    'disks-usage',
    'backup-size',
    'memory-usage',
    'cpu-usage',
    'disk-usage-by-database',
  ],
  [CHART_CATEGORIES.REPLICATION]: [
    'replication-queue-count',
    'replication-summary-table',
    'readonly-replica',
  ],
  [CHART_CATEGORIES.ZOOKEEPER]: [
    'zookeeper-summary-table',
    'zookeeper-uptime',
    'zookeeper-requests',
    'zookeeper-wait',
    'zookeeper-exception',
  ],
  [CHART_CATEGORIES.CONNECTION]: [
    'connections-interserver',
    'connections-http',
    'connections-pool',
  ],
  [CHART_CATEGORIES.TABLE]: ['top-table-size', 'parts-per-table'],
  [CHART_CATEGORIES.PAGE_VIEW]: ['page-view'],
  [CHART_CATEGORIES.FACTORY]: [],
  [CHART_CATEGORIES.PRIMITIVES]: [],
}
