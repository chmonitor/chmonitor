/**
 * Chart query registry for dashboard.
 *
 * Ported from apps/dashboard/lib/api/chart-registry.ts. A chart is a builder
 * function `(params) => ChartQueryResult` registered under a name. The
 * dashboard composes 15 domain chart modules into one map; this module does
 * the same by importing every domain module and registering its builders at
 * load time (see the registration block at the bottom of this file). The
 * `registerChartQuery`/`registerChartQueries` surface is also exposed for
 * dynamic registration, plus the same get/has/list surface the route uses.
 *
 * Chart-data types are defined locally; they mirror `@/types/chart-data` so
 * ported chart builders (typed with the canonical types) need no edits — the
 * canonical result type only adds optional fields, so builders stay assignable.
 */

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

/** Cache policy → Cache-Control TTL bucket (handler maps to headers). */
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

/** A single chart row — permissive, like the dashboard's ChartDataPoint. */
export interface ChartDataPoint {
  [key: string]: unknown
}

/** Time-series row with a required `event_time`. */
export interface TimeSeriesPoint extends ChartDataPoint {
  event_time: string
}

/** Params passed to a chart builder. */
export interface ChartQueryParams {
  interval?: ClickHouseInterval
  lastHours?: number
  params?: Record<string, unknown>
  /** IANA timezone for the ClickHouse session. */
  timezone?: string
}

/** Single-query chart result. */
export interface ChartQueryResult<_T extends ChartDataPoint = ChartDataPoint> {
  /** SQL (string) — required; the executor runs this. */
  query: string
  /** Optional version-aware SQL; takes precedence over `query` when present. */
  sql?: VersionedSql[]
  queryParams?: Record<string, unknown>
  optional?: boolean
  tableCheck?: string | string[]
  cachePolicy?: CachePolicy
  /**
   * Opt out of the ClickHouse query-cache settings (#2182) the route applies
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

/** Multi-query chart result (executed in parallel, keyed). */
export interface MultiChartQueryResult {
  queries: Array<{ key: string; query: string; optional?: boolean }>
  cachePolicy?: CachePolicy
  /** Opt out of query-cache settings; see `ChartQueryResult.disableQueryCache`. */
  disableQueryCache?: boolean
  /** Deployment-level feature gate; enforced by the route before executing. */
  permission?: FeaturePermission
}

/** A chart builder maps params to a (multi-)query result. */
export type ChartQueryBuilder<T extends ChartDataPoint = ChartDataPoint> = (
  params: ChartQueryParams
) => ChartQueryResult<T> | MultiChartQueryResult

/**
 * Lazy registry map. Empty in the foundation; populated by ported chart
 * modules via `registerChartQuery` (or a bulk `registerChartQueries`).
 */
const chartRegistry = new Map<string, ChartQueryBuilder<ChartDataPoint>>()

/** Register one chart builder. Last write wins (overwrite warns in dev). */
export function registerChartQuery(
  name: string,
  builder: ChartQueryBuilder<ChartDataPoint>
): void {
  chartRegistry.set(name, builder)
}

/** Register a map of chart builders (spread a ported domain module). */
export function registerChartQueries(
  builders: Record<string, ChartQueryBuilder<ChartDataPoint>>
): void {
  for (const [name, builder] of Object.entries(builders)) {
    chartRegistry.set(name, builder)
  }
}

/** Build a chart query by name. Returns null if unknown. */
export function getChartQuery(
  chartName: string,
  params: ChartQueryParams = {}
): ChartQueryResult | MultiChartQueryResult | null {
  const builder = chartRegistry.get(chartName)
  if (!builder) return null
  return builder(params)
}

/** All registered chart names. */
export function getAvailableCharts(): string[] {
  return Array.from(chartRegistry.keys())
}

/** Does a chart exist? */
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
