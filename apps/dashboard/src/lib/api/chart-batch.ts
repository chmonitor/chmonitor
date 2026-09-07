/**
 * Fixed chart groupings for batch execution.
 *
 * Arbitrary name lists are rejected: a free-form batch would fragment the
 * cache key and bypass per-chart rate-limit accounting. Callers pick a
 * known grouping id; the server runs that frozen name list through the
 * existing `executeChartQuery` / registry path.
 */

import type { FetchDataResult } from '@chm/clickhouse-client'
import type { ExecuteOptions } from '@/lib/api/query-executor'

import {
  type ChartQueryParams,
  cachePolicyToQueryCacheTtlSeconds,
  getChartQuery,
} from '@/lib/api/chart-registry'
import { executeChartQuery } from '@/lib/api/query-executor'
import { chartCachePolicy } from '@/lib/swr/chart-freshness'

/** Insight stats-grid tiles — one grouping, one request. */
export const INSIGHTS_STATS_GROUPING = Object.freeze([
  'insight-largest-scan',
  'insight-fastest-scan',
  'insight-longest-query',
  'insight-total-storage',
  'insight-total-queries',
  'insight-total-scanned',
  'insight-total-rows-read',
  'insight-peak-memory',
  'insight-active-queries',
  'insight-current-memory',
  'insight-http-connections',
  'insight-active-merges',
  'insight-active-parts',
  'insight-detached-parts',
  'insight-active-mutations',
  'insight-busiest-day-queries',
  'insight-busiest-day-bytes',
  'insight-busiest-second',
  'insight-avg-duration',
  'insight-error-rate',
] as const)

/** Query Insights overview grid — 15 charts, one batch request. */
export const QUERY_INSIGHTS_GROUPING = Object.freeze([
  'query-insights-qps',
  'query-insights-latency',
  'query-insights-operations',
  'query-insights-rows',
  'query-insights-cache-hit-ratio',
  'query-insights-errors',
  'query-insights-memory',
  'query-insights-read-throughput',
  'query-insights-top-users',
  'query-insights-duration-distribution',
  'query-insights-memory-distribution',
  'query-insights-read-rows-distribution',
  'query-insights-read-bytes-distribution',
  'query-insights-errors-by-code',
  'query-insights-hot-tables',
] as const)

export const CHART_GROUPINGS = Object.freeze({
  'insights-stats': INSIGHTS_STATS_GROUPING,
  'query-insights': QUERY_INSIGHTS_GROUPING,
} as const)

export type ChartGroupingId = keyof typeof CHART_GROUPINGS

export class UnknownChartGroupingError extends Error {
  readonly groupingId: string
  constructor(groupingId: string) {
    super(`Unknown chart grouping: ${groupingId}`)
    this.name = 'UnknownChartGroupingError'
    this.groupingId = groupingId
  }
}

export function isKnownChartGrouping(id: string): id is ChartGroupingId {
  return Object.hasOwn(CHART_GROUPINGS, id)
}

/** @deprecated alias — prefer isKnownChartGrouping */
export const isChartGroupingId = isKnownChartGrouping

const NAME_TO_GROUPING = new Map<string, ChartGroupingId>()
for (const [id, names] of Object.entries(CHART_GROUPINGS)) {
  for (const name of names) {
    NAME_TO_GROUPING.set(name, id as ChartGroupingId)
  }
}

export function chartGroupingIdForName(
  chartName: string
): ChartGroupingId | undefined {
  return NAME_TO_GROUPING.get(chartName)
}

export function getChartGrouping(
  groupingId: string
): readonly string[] | undefined {
  if (!isKnownChartGrouping(groupingId)) return undefined
  return CHART_GROUPINGS[groupingId]
}

export interface ChartGroupingEntry {
  dataJson: string | null
  error?: FetchDataResult<never>['error']
  metadata?: Record<string, string | number>
  executedSql?: string
}

export interface ExecuteChartGroupingOptions extends ExecuteOptions {
  lastHours?: number
  interval?: ChartQueryParams['interval']
  params?: Record<string, unknown>
}

/**
 * Run every chart in a known grouping via `executeChartQuery`. Per-name
 * errors are isolated so one missing table does not fail the rest.
 */
export async function executeChartGrouping(
  groupingId: string,
  hostId: number,
  opts: ExecuteChartGroupingOptions = {}
): Promise<Record<string, ChartGroupingEntry>> {
  const names = getChartGrouping(groupingId)
  if (!names) throw new UnknownChartGroupingError(groupingId)

  const { lastHours, interval, params, timezone, bindings } = opts
  const entries = await Promise.all(
    names.map(async (name): Promise<[string, ChartGroupingEntry]> => {
      try {
        const queryDef = getChartQuery(name, {
          lastHours,
          interval,
          params,
          timezone,
        })
        if (!queryDef) {
          return [
            name,
            {
              dataJson: null,
              error: {
                type: 'query_error',
                message: `Failed to build query for chart: ${name}`,
              },
            },
          ]
        }
        if ('queries' in queryDef) {
          return [
            name,
            {
              dataJson: null,
              error: {
                type: 'query_error',
                message: `Multi-query chart not supported in grouping: ${name}`,
              },
            },
          ]
        }

        const result = await executeChartQuery(
          name,
          queryDef.sql ?? queryDef.query,
          hostId,
          queryDef.queryParams,
          {
            bindings,
            timezone,
            optional: queryDef.optional,
            tableCheck: queryDef.tableCheck,
            columnCheck: queryDef.columnCheck,
            ttlSeconds: cachePolicyToQueryCacheTtlSeconds(queryDef.cachePolicy),
            disableQueryCache: queryDef.disableQueryCache,
          }
        )

        if (
          result.error &&
          queryDef.optional &&
          (result.error.type === 'table_not_found' ||
            result.error.type === 'column_not_found')
        ) {
          return [
            name,
            {
              dataJson: '[]',
              metadata: result.metadata,
              executedSql: result.executedSql,
            },
          ]
        }

        return [
          name,
          {
            dataJson: result.dataJson,
            error: result.error,
            metadata: result.metadata,
            executedSql: result.executedSql,
          },
        ]
      } catch (err) {
        return [
          name,
          {
            dataJson: null,
            error: {
              type: 'query_error',
              message: err instanceof Error ? err.message : 'Unknown error',
            },
          },
        ]
      }
    })
  )

  return Object.fromEntries(entries)
}

/** s-maxage for a cache policy — mirrors GET /api/v1/charts/$name. */
function sMaxAgeForPolicy(policy: string | undefined): number {
  if (policy === 'realtime') return 10
  if (policy === 'historical') return 120
  return 30
}

function policyForName(name: string): string | undefined {
  const def = getChartQuery(name)
  if (def && 'cachePolicy' in def && def.cachePolicy) return def.cachePolicy
  return chartCachePolicy(name)
}

/** Tightest cache policy among grouping members (realtime < standard < historical). */
export function groupingCachePolicy(
  groupingId: ChartGroupingId,
  _params?: unknown
): 'realtime' | 'standard' | 'historical' {
  const names = CHART_GROUPINGS[groupingId]
  let min = Number.POSITIVE_INFINITY
  let policy: 'realtime' | 'standard' | 'historical' = 'standard'
  for (const name of names) {
    const member = policyForName(name)
    const sMax = sMaxAgeForPolicy(member)
    if (sMax < min) {
      min = sMax
      policy =
        sMax === 10 ? 'realtime' : sMax === 120 ? 'historical' : 'standard'
    }
  }
  return policy
}

/** Cache-Control using the minimum s-maxage of grouping members. */
export function groupingCacheControl(names: readonly string[]): string {
  let min = Number.POSITIVE_INFINITY
  for (const name of names) {
    const sMax = sMaxAgeForPolicy(policyForName(name))
    if (sMax < min) min = sMax
  }
  const sMaxAge = Number.isFinite(min) ? min : 30
  const swr = sMaxAge === 10 ? 30 : sMaxAge === 120 ? 300 : 60
  return `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
}
