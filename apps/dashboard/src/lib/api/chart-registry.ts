import type { VersionedSql } from '@chm/sql-builder'
import type { FeaturePermission } from '@/lib/feature-permissions/types'
import type { ClickHouseInterval } from './query-executor'

import { connectionCharts } from './charts/connection-charts'
import { dashboardCharts } from './charts/dashboard-charts'
import { dictionaryCharts } from './charts/dictionary-charts'
import { insightCharts } from './charts/insight-charts'
import { logsCharts } from './charts/logs-charts'
import { mergeCharts } from './charts/merge-charts'
import { overviewCharts } from './charts/overview-charts'
import { pageViewCharts } from './charts/page-view-charts'
import { queryCharts } from './charts/query-charts'
import { queryInsightsCharts } from './charts/query-insights-charts'
import { queryPerfCharts } from './charts/query-perf-charts'
import { replicationCharts } from './charts/replication-charts'
import { securityCharts } from './charts/security-charts'
import { systemCharts } from './charts/system-charts'
import { threadCharts } from './charts/thread-charts'
import { trafficCharts } from './charts/traffic-charts'
import { zookeeperCharts } from './charts/zookeeper-charts'
import { chartCachePolicy } from '@/lib/swr/chart-freshness'

export type CachePolicy = 'realtime' | 'standard' | 'historical'

/**
 * Maps a chart's cache policy to the ClickHouse server-side query-cache TTL
 * (seconds) — mirrors the Cache-Control `s-maxage` buckets the route sets
 * for the same policy (see routes/api/v1/charts/$name.ts), since both bound
 * the same staleness. See query-cache-settings.ts for the caching itself.
 */
export function cachePolicyToQueryCacheTtlSeconds(
  cachePolicy?: CachePolicy
): number {
  switch (cachePolicy) {
    case 'realtime':
      return 10
    case 'historical':
      return 120
    default:
      return 30
  }
}

export interface ChartDataPoint {
  [key: string]: unknown
}

export interface TimeSeriesPoint extends ChartDataPoint {
  event_time: string
}

export interface ChartQueryParams {
  interval?: ClickHouseInterval
  lastHours?: number
  params?: Record<string, unknown>
  /** IANA timezone for the ClickHouse session. */
  timezone?: string
}

export interface ChartQuerySettings {
  max_execution_time?: number
}

export interface ChartQueryResult<_T extends ChartDataPoint = ChartDataPoint> {
  query: string
  sql?: VersionedSql[]
  queryParams?: Record<string, unknown>
  optional?: boolean
  tableCheck?: string | string[]
  columnCheck?: string | string[]
  cachePolicy?: CachePolicy
  /**
   * Per-request ClickHouse settings, sent as `clickhouse_settings` rather than
   * a `SETTINGS` clause in the SQL text so the client's central read-only rule
   * can normalize the request. Use `CHART_QUERY_SETTINGS`.
   */
  clickhouseSettings?: ChartQuerySettings
  /**
   * Opt out of the ClickHouse query-cache settings the route applies
   * by default for read-only chart polling. Set this when a chart's result
   * must never be served from the query cache (e.g. it should reflect a
   * change made moments ago more eagerly than `cachePolicy`'s TTL allows).
   */
  disableQueryCache?: boolean
  /**
   * Deployment-level feature gate (e.g. METRICS_PERMISSION on system charts).
   * The route enforces it via `authorizeFeatureRequest` before executing, so
   * `CHM_DISABLED_FEATURES` / `CHM_AUTH_REQUIRED_FEATURES` are honored.
   */
  permission?: FeaturePermission
}

export interface MultiChartQueryResult {
  queries: Array<{ key: string; query: string; optional?: boolean }>
  cachePolicy?: CachePolicy
  /** Opt out of query-cache settings; see `ChartQueryResult.disableQueryCache`. */
  disableQueryCache?: boolean
  /** Deployment-level feature gate; enforced by the route before executing. */
  permission?: FeaturePermission
}

export type ChartQueryBuilder<T extends ChartDataPoint = ChartDataPoint> = (
  params: ChartQueryParams
) => ChartQueryResult<T> | MultiChartQueryResult

const chartRegistry = new Map<string, ChartQueryBuilder<ChartDataPoint>>()

export function registerChartQuery(
  name: string,
  builder: ChartQueryBuilder<ChartDataPoint>
): void {
  chartRegistry.set(name, builder)
}

export function registerChartQueries(
  builders: Record<string, ChartQueryBuilder<ChartDataPoint>>
): void {
  for (const [name, builder] of Object.entries(builders)) {
    chartRegistry.set(name, builder)
  }
}

export function getChartQuery(
  chartName: string,
  params: ChartQueryParams = {}
): ChartQueryResult | MultiChartQueryResult | null {
  const builder = chartRegistry.get(chartName)
  if (!builder) return null
  const result = builder(params)
  // Audited charts get an explicit HTTP/query-cache TTL.
  // A builder that already set cachePolicy wins.
  const cachePolicy = result.cachePolicy ?? chartCachePolicy(chartName)
  if (!cachePolicy || result.cachePolicy === cachePolicy) return result
  return { ...result, cachePolicy }
}

export function getAvailableCharts(): string[] {
  return Array.from(chartRegistry.keys())
}

export function hasChart(chartName: string): boolean {
  return chartRegistry.has(chartName)
}

/**
 * Compose all domain chart modules into the registry at module load.
 *
 * The route handler imports this module for `hasChart`/`getChartQuery`, so
 * importing it triggers this side effect before any request is served. Order
 * mirrors the original dashboard; later spreads win on name collisions.
 */
registerChartQueries({
  ...queryCharts,
  ...mergeCharts,
  ...systemCharts,
  ...connectionCharts,
  ...replicationCharts,
  ...zookeeperCharts,
  ...pageViewCharts,
  ...overviewCharts,
  ...dashboardCharts,
  ...securityCharts,
  ...threadCharts,
  ...logsCharts,
  ...dictionaryCharts,
  ...queryPerfCharts,
  ...insightCharts,
  ...queryInsightsCharts,
  ...trafficCharts,
})
