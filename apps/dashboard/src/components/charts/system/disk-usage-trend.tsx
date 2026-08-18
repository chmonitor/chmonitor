import type { ChartProps } from '@/components/charts/chart-props'
import type { ChartDataPoint } from '@/types/chart-data'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { AreaChart } from '@/components/charts/primitives/area'
import { pivotRows, type RawRow } from '@/lib/chart-utils'
import { formatReadableSize } from '@/lib/format-readable'
import { useChartData, useHostId } from '@/lib/swr'
import { chartTickFormatters, createDateTickFormatter } from '@/lib/utils'

const CHART_NAME = 'disk-usage-trend'
const DEFAULT_TITLE = 'Disk Usage Trend (7 Days)'
const DEFAULT_INTERVAL = 'toStartOfHour'
const DEFAULT_LAST_HOURS = 24 * 7

/** Compute total disk usage (sum of all categories) for a pivoted data row */
function rowTotal(row: ChartDataPoint): number {
  return Object.entries(row)
    .filter(([k]) => k !== 'event_time')
    .reduce((sum, [, v]) => sum + (typeof v === 'number' ? v : 0), 0)
}

function lastHoursLabel(hours: number): string {
  if (hours <= 24) return '24h'
  return `${Math.round(hours / 24)}d`
}

export function ChartDiskUsageTrend({
  title = DEFAULT_TITLE,
  interval = DEFAULT_INTERVAL,
  lastHours = DEFAULT_LAST_HOURS,
  className,
  chartClassName,
}: ChartProps) {
  const hostId = useHostId()
  const swr = useChartData<RawRow>({
    chartName: CHART_NAME,
    hostId,
    interval,
    lastHours,
  })

  const { pivoted, categories } = (() => {
    if (!swr.data || swr.data.length === 0) {
      return { pivoted: [], categories: [] }
    }
    return pivotRows(swr.data)
  })()

  const tickFormatter = createDateTickFormatter(lastHours)

  // Delta badge: compare first vs last total across all series
  const deltaBadge = (() => {
    if (pivoted.length < 2) return null
    const first = rowTotal(pivoted[0] as ChartDataPoint)
    const last = rowTotal(pivoted[pivoted.length - 1] as ChartDataPoint)
    const delta = last - first
    if (delta === 0) return null
    const isUp = delta > 0
    const label = `${isUp ? '▲' : '▼'} ${isUp ? '+' : ''}${formatReadableSize(delta)} / ${lastHoursLabel(lastHours)}`
    return (
      <span
        className={
          isUp
            ? 'text-xs font-semibold text-amber-500'
            : 'text-xs font-semibold text-emerald-500'
        }
      >
        {label}
      </span>
    )
  })()

  if (!swr.isLoading && !swr.error && pivoted.length === 0) {
    return (
      <ChartEmpty
        title={title}
        className={className}
        description="No disk usage data recorded in this time period"
        sql={swr.sql}
        data={swr.data}
        metadata={swr.metadata}
        onRetry={() => swr.mutate()}
      />
    )
  }

  return (
    <ChartContainer
      swr={swr}
      title={title}
      className={className}
      chartClassName={chartClassName}
    >
      {(_, sql, metadata, staleError, mutate) => (
        <ChartCard
          title={title}
          sql={sql}
          data={pivoted as ChartDataPoint[]}
          metadata={metadata}
          data-testid="disk-usage-trend-chart"
          staleError={staleError}
          onRetry={mutate}
        >
          {deltaBadge && (
            <div className="flex justify-end mb-1">{deltaBadge}</div>
          )}
          <AreaChart
            className="h-full w-full"
            data={pivoted as ChartDataPoint[]}
            index="event_time"
            categories={categories}
            showLegend={categories.length > 1}
            tickFormatter={tickFormatter}
            yAxisTickFormatter={chartTickFormatters.bytes}
          />
        </ChartCard>
      )}
    </ChartContainer>
  )
}

export type ChartDiskUsageTrendProps = ChartProps

export default ChartDiskUsageTrend
