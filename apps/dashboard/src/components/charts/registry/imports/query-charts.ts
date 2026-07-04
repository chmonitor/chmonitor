/**
 * Query chart imports
 *
 * Lazy-loaded query-related charts.
 */

import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const queryChartImports: ChartRegistryMap = {
  'query-count': lazy(() =>
    import('@/components/charts/query/query-count').then((m) => ({
      default: m.ChartQueryCount,
    }))
  ),
  'query-count-by-user': lazy(() =>
    import('@/components/charts/query/query-count-by-user').then((m) => ({
      default: m.ChartQueryCountByUser,
    }))
  ),
  'query-duration': lazy(() =>
    import('@/components/charts/query/query-duration').then((m) => ({
      default: m.ChartQueryDuration,
    }))
  ),
  'query-memory': lazy(() =>
    import('@/components/charts/query/query-memory').then((m) => ({
      default: m.ChartQueryMemory,
    }))
  ),
  'query-metric-log-memory': lazy(() =>
    import('@/components/charts/query/query-metric-log-memory').then((m) => ({
      default: m.ChartQueryMetricLogMemory,
    }))
  ),
  'query-type': lazy(() =>
    import('@/components/charts/query/query-type').then((m) => ({
      default: m.ChartQueryType,
    }))
  ),
  'failed-query-count': lazy(() =>
    import('@/components/charts/query/failed-query-count').then((m) => ({
      default: m.ChartFailedQueryCount,
    }))
  ),
  'failed-query-count-by-user': lazy(() =>
    import('@/components/charts/query/failed-query-count-by-user').then(
      (m) => ({
        default: m.ChartFailedQueryCountByUser,
      })
    )
  ),
  'query-cache': lazy(() =>
    import('@/components/charts/query/query-cache').then((m) => ({
      default: m.ChartQueryCache,
    }))
  ),
  'query-cache-usage': lazy(() =>
    import('@/components/charts/query/query-cache-usage').then((m) => ({
      default: m.ChartQueryCacheUsage,
    }))
  ),
  'top-query-fingerprints': lazy(() =>
    import('@/components/charts/query/top-query-fingerprints').then((m) => ({
      default: m.ChartTopQueryFingerprints,
    }))
  ),
  'cancelled-queries': lazy(() =>
    import('@/components/charts/query/cancelled-queries').then((m) => ({
      default: m.ChartCancelledQueries,
    }))
  ),
  'query-duration-percentiles': lazy(() =>
    import('@/components/charts/query/query-duration-percentiles').then(
      (m) => ({
        default: m.ChartQueryDurationPercentiles,
      })
    )
  ),
  'slow-query-occurrences': lazy(() =>
    import('@/components/charts/query/slow-query-occurrences').then((m) => ({
      default: m.ChartSlowQueryOccurrences,
    }))
  ),
  'query-count-heatmap': lazy(() =>
    import('@/components/charts/query/query-count-heatmap').then((m) => ({
      default: m.ChartQueryCountHeatmap,
    }))
  ),
}
