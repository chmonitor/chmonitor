import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const logsChartImports: ChartRegistryMap = {
  'log-level-distribution': lazy(() =>
    import('@/components/charts/logs/log-level-distribution').then((m) => ({
      default: m.ChartLogLevelDistribution,
    }))
  ),
  'error-rate-over-time': lazy(() =>
    import('@/components/charts/logs/error-rate-over-time').then((m) => ({
      default: m.ChartErrorRateOverTime,
    }))
  ),
  'crash-frequency': lazy(() =>
    import('@/components/charts/logs/crash-frequency').then((m) => ({
      default: m.ChartCrashFrequency,
    }))
  ),
}
