import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const threadChartImports: ChartRegistryMap = {
  'thread-utilization': lazy(() =>
    import('@/components/charts/threads/thread-utilization').then((m) => ({
      default: m.ChartThreadUtilization,
    }))
  ),
}
