import { Activity } from 'lucide-react'

import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { StatTile } from '@/components/charts/primitives/stat-tile'
import { ChartSkeleton } from '@/components/skeletons'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

export const ChartSummaryUsedByMutations =
  function ChartSummaryUsedByMutations({
    title,
    className,
    hostId,
  }: ChartProps) {
    const { data, isLoading, error, mutate, sql } = useChartData<{
      running_count: number
    }>({
      chartName: 'summary-used-by-mutations',
      hostId,
      refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
    })

    const dataArray = Array.isArray(data) ? data : undefined

    if (isLoading) return <ChartSkeleton title={title} className={className} />
    if (error)
      return (
        <ChartError
          error={error}
          title={title}
          onRetry={mutate}
          className={className}
        />
      )

    if (!dataArray || dataArray.length === 0) {
      return <ChartEmpty title={title} className={className} />
    }

    const count = dataArray[0]
    const isIdle = count.running_count === 0

    return (
      <ChartCard title={title} sql={sql} data={dataArray} className={className}>
        <StatTile value={count.running_count} label="running" layout="inline">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity
              className={
                isIdle
                  ? 'size-3.5 text-muted-foreground/50'
                  : 'size-3.5 text-emerald-500'
              }
              strokeWidth={1.5}
            />
            <span>
              {isIdle ? 'no active mutations' : 'mutations in progress'}
            </span>
          </div>
        </StatTile>
      </ChartCard>
    )
  }
