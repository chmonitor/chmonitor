import type { MirrorMetricsSummary } from './use-mirror-metrics'

import { useMirrorMetrics } from './use-mirror-metrics'
import { useEffect } from 'react'

/**
 * Headless per-mirror metrics fetch. Mounted for the eager KPI budget so
 * collapsed prefix groups still contribute to page totals without rendering
 * a table row (and so we can unmount collapsed rows without dropping KPIs).
 */
export function MirrorMetricsProbe({
  name,
  isCdc,
  onMetrics,
}: {
  name: string
  isCdc: boolean
  onMetrics: (name: string, summary: MirrorMetricsSummary) => void
}) {
  const metrics = useMirrorMetrics(name, isCdc, true)
  const trendKey = metrics.trend.join(',')

  // biome-ignore lint/correctness/useExhaustiveDependencies: trend tracked via trendKey
  useEffect(() => {
    if (metrics.source !== 'live') return
    onMetrics(name, {
      rowsPerSec: metrics.rowsPerSec,
      rowsSynced: metrics.rowsSynced,
      trend: metrics.trend,
      lagSec: metrics.lagSec,
      source: 'live',
    })
  }, [
    name,
    metrics.rowsPerSec,
    metrics.rowsSynced,
    trendKey,
    metrics.lagSec,
    metrics.loading,
    metrics.source,
    onMetrics,
  ])

  return null
}
