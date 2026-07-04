/**
 * widget-chart — renders a registry chart inside a dashboard widget,
 * wired to the shared dashboard time range. `lastHours`/`interval` are
 * passed as EXPLICIT props (not left to fall back to the app-wide time
 * range context), which is what makes the dashboard's own
 * `DateRangeSelector` the effective baseline for every chart widget — see
 * `time-range-context.tsx` for the full priority-chain explanation.
 */

import type { DashboardWidget } from '@/types/dashboard-layout'

import { useDashboardTimeRange } from './time-range-context'
import { Suspense } from 'react'
import { getChartComponent, hasChart } from '@/components/charts/registry'
import { ChartSkeleton } from '@/components/skeletons'
import { EmptyState } from '@/components/ui/empty-state'
import { useHostId } from '@/lib/swr'

export function WidgetChart({ widget }: { widget: DashboardWidget }) {
  const hostId = useHostId()
  const { lastHours, interval } = useDashboardTimeRange()

  if (!widget.chartName || !hasChart(widget.chartName)) {
    return (
      <EmptyState
        variant="no-data"
        compact
        title="Chart not found"
        description={
          widget.chartName
            ? `"${widget.chartName}" is not a registered chart.`
            : 'This widget has no chart selected.'
        }
      />
    )
  }

  const Chart = getChartComponent(widget.chartName)
  if (!Chart) return null

  return (
    <Suspense fallback={<ChartSkeleton />}>
      <Chart
        hostId={hostId}
        lastHours={lastHours}
        interval={interval}
        title={widget.title}
        className="h-full w-full"
      />
    </Suspense>
  )
}
