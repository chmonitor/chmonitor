import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const mergeChartImports: ChartRegistryMap = {
  'merge-count': lazy(() =>
    import('@/components/charts/merge/merge-count').then((m) => ({
      default: m.ChartMergeCount,
    }))
  ),
  'summary-used-by-merges': lazy(() =>
    import('@/components/charts/merge/summary-used-by-merges').then((m) => ({
      default: m.default,
    }))
  ),
  'merge-avg-duration': lazy(() =>
    import('@/components/charts/merge/merge-avg-duration').then((m) => ({
      default: m.ChartMergeAvgDuration,
    }))
  ),
  'merge-sum-read-rows': lazy(() =>
    import('@/components/charts/merge/merge-sum-read-rows').then((m) => ({
      default: m.ChartMergeSumReadRows,
    }))
  ),
  'new-parts-created': lazy(() =>
    import('@/components/charts/merge/new-parts-created').then((m) => ({
      default: m.ChartNewPartsCreated,
    }))
  ),
}
