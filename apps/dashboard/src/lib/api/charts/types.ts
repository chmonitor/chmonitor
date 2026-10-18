export type {
  ChartDataPoint,
  ChartQueryBuilder,
  ChartQueryParams,
  ChartQueryResult,
  ChartQuerySettings,
  MultiChartQueryResult,
  TimeSeriesPoint,
} from '@/types/chart-data'

import type { ChartQuerySettings } from '@/types/chart-data'

/**
 * Settings every chart in the query modules sends with its request (#3684).
 *
 * `max_execution_time = 25` keeps execution under the Cloudflare Worker
 * response timeout (~30s): a slow scan then fails with a clean ClickHouse
 * timeout (159) instead of an empty body (1016). It is a client setting, not a
 * `SETTINGS` clause in the SQL text, so the client's central read-only rule
 * normalizes it along with the rest of the request.
 */
export const CHART_QUERY_SETTINGS = {
  max_execution_time: 25,
} as const satisfies ChartQuerySettings

export {
  applyInterval,
  buildTimeFilter,
  buildTimeFilterInterval,
  fillStep,
  nowOrToday,
} from '@/lib/clickhouse-query'
