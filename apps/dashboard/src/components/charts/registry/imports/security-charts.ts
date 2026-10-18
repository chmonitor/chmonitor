import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const securityChartImports: ChartRegistryMap = {
  'login-success-rate': lazy(() =>
    import('@/components/charts/security/login-success-rate').then((m) => ({
      default: m.ChartLoginSuccessRate,
    }))
  ),
  'active-sessions-count': lazy(() =>
    import('@/components/charts/security/active-sessions-count').then((m) => ({
      default: m.ChartActiveSessionsCount,
    }))
  ),
}
