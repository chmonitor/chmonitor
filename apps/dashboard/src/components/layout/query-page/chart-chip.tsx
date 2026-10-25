import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react'

import type { ClickHouseInterval } from '@chm/types/clickhouse-interval'

import {
  type ChartValueUnit,
  formatChartValue,
  inferUnit,
} from './chart-format'
import { deriveChartSummary } from './derive-chart-summary'
import { MiniAreaChart } from '@/components/charts/mini-charts'
import { useChartData } from '@/lib/query/use-chart-data'
import { useHostId } from '@/lib/swr'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { cn } from '@/lib/utils'

export interface ChartChipProps {
  chartName: string
  label: string
  valueField?: string
  unit?: ChartValueUnit
  interval?: ClickHouseInterval
  lastHours?: number
}

const TREND_COLOR = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-rose-600 dark:text-rose-400',
  flat: 'text-muted-foreground',
} as const

const SPARK_COLOR = {
  up: 'hsl(160 84% 39%)',
  down: 'hsl(347 77% 50%)',
  flat: 'hsl(217 10% 60%)',
} as const

export const ChartChip = function ChartChip({
  chartName,
  label,
  valueField,
  unit,
  interval,
  lastHours,
}: ChartChipProps) {
  const hostId = useHostId()
  const { data, isLoading, hasData } = useChartData({
    chartName,
    hostId,
    interval,
    lastHours,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })

  const summary = deriveChartSummary(data, valueField)
  const trendKey = summary.trend ?? 'flat'

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
      <span className="truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>

      {isLoading && !hasData ? (
        <span className="h-3 w-12 shrink-0 animate-pulse rounded bg-foreground/[0.06]" />
      ) : summary.latest !== null ? (
        <>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground/90">
            {formatChartValue(summary.latest, unit ?? inferUnit(summary.field))}
          </span>
          {summary.deltaPct !== null &&
          summary.trend &&
          summary.trend !== 'flat' ? (
            <span
              className={cn(
                'flex shrink-0 items-center gap-0.5 text-[10px] max-sm:text-xs font-medium tabular-nums',
                TREND_COLOR[trendKey]
              )}
            >
              {summary.trend === 'up' ? (
                <TrendingUpIcon className="size-3" />
              ) : (
                <TrendingDownIcon className="size-3" />
              )}
              {Math.abs(summary.deltaPct).toFixed(0)}%
            </span>
          ) : null}
          {summary.spark.length >= 2 ? (
            <div className="ml-1 h-4 w-14 shrink-0">
              <MiniAreaChart
                data={summary.spark}
                label={label}
                color={SPARK_COLOR[trendKey]}
              />
            </div>
          ) : null}
        </>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground/60">•••</span>
      )}
    </div>
  )
}
