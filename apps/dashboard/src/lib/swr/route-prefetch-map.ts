/**
 * Maps routes to the chart/table names they fetch data for.
 * Used by prefetchRoute() to pre-populate SWR cache on nav link hover.
 *
 * Only covers frequently navigated routes with predictable data needs.
 * Chart names must match the `chartName` param used in useChartData().
 * Table names must match the `queryConfigName` param used in useTableData().
 */

export interface PrefetchConfig {
  charts?: string[]
  tables?: string[]
}

export const routePrefetchMap: Record<string, PrefetchConfig> = {
  '/overview': {
    charts: [
      'running-queries-count',
      'query-count-today',
      'disk-size-single',
      'query-count',
      'query-count-by-user',
      'memory-usage',
      'cpu-usage',
    ],
  },
  '/tables': {
    tables: ['tables'],
  },
  '/running-queries': {
    tables: ['running-queries'],
    charts: ['summary-used-by-running-queries'],
  },
  '/clusters': {
    tables: ['clusters'],
  },
  '/dashboard': {
    charts: ['dashboard-charts', 'dashboard-settings'],
  },
  '/merges': {
    tables: ['merges'],
    charts: ['merge-count', 'merge-avg-duration'],
  },
  '/query-history': {
    tables: ['query-history'],
  },
  '/disks': {
    charts: ['disk-size', 'disks-usage'],
  },
}
