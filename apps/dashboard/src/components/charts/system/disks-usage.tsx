import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'
import type { ChartDataPoint } from '@/types/chart-data'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { AreaChart } from '@/components/charts/primitives/area'
import { resolveDateRangeConfig } from '@/components/date-range'
import { useChartData, useHostId } from '@/lib/swr'
import { chartTickFormatters, createDateTickFormatter } from '@/lib/utils'

const CHART_NAME = 'disks-usage'
const DEFAULT_TITLE = 'Disks Usage'
const DEFAULT_INTERVAL = 'toStartOfDay'
const DEFAULT_LAST_HOURS = 24 * 30
const CATEGORIES = ['DiskAvailable_default', 'DiskUsed_default']
const COLORS = ['--chart-1', '--chart-2']

const dateRangeConfig = resolveDateRangeConfig('disk-usage')

function lastHoursLabel(hours: number): string {
  if (hours <= 24) return 'Last 24h'
  const days = Math.round(hours / 24)
  return `Last ${days}d`
}

export function ChartDisksUsage({
  title = DEFAULT_TITLE,
  interval = DEFAULT_INTERVAL,
  lastHours = DEFAULT_LAST_HOURS,
  className,
  chartClassName,
  chartCardContentClassName,
  hostId: hostIdProp,
  href,
}: ChartProps) {
  const routeHostId = useHostId()
  const hostId = hostIdProp ?? routeHostId

  const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
    null
  )

  const effectiveLastHours = rangeOverride?.lastHours ?? lastHours
  const effectiveInterval = rangeOverride?.interval ?? interval

  const swr = useChartData({
    chartName: CHART_NAME,
    hostId,
    interval: effectiveInterval,
    lastHours: effectiveLastHours,
  })

  const tickFormatter = createDateTickFormatter(effectiveLastHours)

  if (!swr.isLoading && !swr.error && (!swr.data || swr.data.length === 0)) {
    return (
      <ChartEmpty
        title={title}
        className={className}
        description="No disk usage data recorded in this time period"
        sql={swr.sql}
        data={swr.data}
        metadata={swr.metadata}
        onRetry={() => swr.mutate()}
        href={href}
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
      {(dataArray, sql, metadata, staleError, mutate) => (
        <ChartCard
          title={title}
          sql={sql}
          data={dataArray as ChartDataPoint[]}
          metadata={metadata}
          data-testid="disk-usage-chart"
          dateRangeConfig={dateRangeConfig}
          currentRange={rangeOverride?.value}
          onRangeChange={setRangeOverride}
          staleError={staleError}
          onRetry={mutate}
          contentClassName={chartCardContentClassName}
          href={href}
        >
          <div className="flex justify-end mb-1">
            <span className="text-xs text-muted-foreground font-mono">
              {lastHoursLabel(effectiveLastHours)}
            </span>
          </div>
          <AreaChart
            className="h-full w-full"
            data={dataArray as ChartDataPoint[]}
            index="event_time"
            categories={CATEGORIES}
            colors={COLORS}
            showLegend
            stack
            tickFormatter={tickFormatter}
            yAxisTickFormatter={chartTickFormatters.bytes}
          />
        </ChartCard>
      )}
    </ChartContainer>
  )
}

export type ChartDisksUsageProps = ChartProps

export default ChartDisksUsage
