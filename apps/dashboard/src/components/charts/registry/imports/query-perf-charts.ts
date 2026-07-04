/**
 * Query performance chart imports
 *
 * Lazy-loaded charts for insert throughput and top inserters.
 */

import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const queryPerfChartImports: ChartRegistryMap = {
  'insert-performance': lazy(() =>
    import('@/components/charts/query-performance/insert-performance').then(
      (m) => ({
        default: m.ChartInsertPerformance,
      })
    )
  ),
  'top-inserters': lazy(() =>
    import('@/components/charts/query-performance/top-inserters').then((m) => ({
      default: m.ChartTopInserters,
    }))
  ),
  'top-query-fingerprints-perf': lazy(() =>
    import('@/components/charts/query-performance/top-query-fingerprints').then(
      (m) => ({
        default: m.ChartTopQueryFingerprints,
      })
    )
  ),
  'query-duration-trend': lazy(() =>
    import('@/components/charts/query-performance/query-duration-trend').then(
      (m) => ({
        default: m.ChartQueryDurationTrend,
      })
    )
  ),
  'query-insights-qps': lazy(() =>
    import('@/components/charts/query-performance/query-insights-qps').then(
      (m) => ({
        default: m.ChartQueryInsightsQps,
      })
    )
  ),
  'query-insights-latency': lazy(() =>
    import('@/components/charts/query-performance/query-insights-latency').then(
      (m) => ({
        default: m.ChartQueryInsightsLatency,
      })
    )
  ),
  'query-insights-operations': lazy(() =>
    import(
      '@/components/charts/query-performance/query-insights-operations'
    ).then((m) => ({
      default: m.ChartQueryInsightsOperations,
    }))
  ),
  'query-insights-rows': lazy(() =>
    import('@/components/charts/query-performance/query-insights-rows').then(
      (m) => ({
        default: m.ChartQueryInsightsRows,
      })
    )
  ),
  'query-insights-cache-hit-ratio': lazy(() =>
    import(
      '@/components/charts/query-performance/query-insights-cache-hit-ratio'
    ).then((m) => ({
      default: m.ChartQueryInsightsCacheHitRatio,
    }))
  ),
  'query-insights-errors': lazy(() =>
    import('@/components/charts/query-performance/query-insights-errors').then(
      (m) => ({
        default: m.ChartQueryInsightsErrors,
      })
    )
  ),
}
