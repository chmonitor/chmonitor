import { CheckCircle2 } from 'lucide-react'

import type { ChartProps } from '@/components/charts/chart-props'
import type { ChartDataPoint } from '@/types/chart-data'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { StatTile } from '@/components/charts/primitives/stat-tile'
import { ChartSkeleton } from '@/components/skeletons'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

interface MutationMetrics extends ChartDataPoint {
  active: number
  stuck: number
  failed: number
}

export const ChartSummaryStuckMutations = function ChartSummaryStuckMutations({
  title,
  className,
  hostId,
}: ChartProps) {
  const { data, isLoading, error, hasData, staleError, mutate, sql } =
    useChartData<MutationMetrics>({
      chartName: 'summary-stuck-mutations',
      hostId,
      refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
    })

  const dataArray = Array.isArray(data) ? data : undefined

  if (isLoading) return <ChartSkeleton title={title} className={className} />
  if (error && !hasData)
    return <ChartError error={error} title={title} onRetry={mutate} />

  if (!dataArray || dataArray.length === 0) {
    return <ChartEmpty title={title} className={className} />
  }

  const metrics = dataArray[0]
  const allClear =
    metrics.active === 0 && metrics.stuck === 0 && metrics.failed === 0

  return (
    <ChartCard
      title={title}
      sql={sql}
      data={dataArray}
      staleError={staleError}
      onRetry={mutate}
      className={className}
    >
      {allClear ? (
        <div className="flex flex-col items-center justify-center gap-2 py-3 text-center">
          <CheckCircle2
            className="size-6 text-emerald-500/70"
            strokeWidth={1.5}
          />
          <span className="text-sm text-muted-foreground">
            All clear — no stuck mutations
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-around gap-2 py-3">
          <StatTile
            value={metrics.active}
            label="active"
            activeClassName="text-foreground"
          />
          <div className="h-8 w-px bg-border/50 shrink-0" aria-hidden />
          <StatTile
            value={metrics.stuck}
            label="stuck"
            activeClassName="text-amber-500 dark:text-amber-400"
          />
          <div className="h-8 w-px bg-border/50 shrink-0" aria-hidden />
          <StatTile
            value={metrics.failed}
            label="failed"
            activeClassName="text-destructive"
          />
        </div>
      )}
    </ChartCard>
  )
}
