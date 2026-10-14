import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { memo, useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { DATE_RANGE_PRESETS } from '@/components/date-range'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'
import { cn } from '@/lib/utils'

// Human-readable labels for ClickHouse exception codes related to cancellation
const EXCEPTION_LABELS: Record<string, string> = {
  '159': 'Timeout',
  '394': 'Killed',
}

function labelForCode(code: string): string {
  return EXCEPTION_LABELS[code] ?? `Code ${code}`
}

export const ChartCancelledQueries = memo(function ChartCancelledQueries({
  title,
  interval = 'toStartOfHour',
  lastHours = 24 * 7,
  className,
  chartClassName,
  chartCardContentClassName,
  hostId,
  ...props
}: ChartProps) {
  const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
    null
  )

  // Use override values when date range is selected, otherwise use props/defaults
  // Must use ternary (not ??) so explicit `undefined` override (e.g. "all time") is preserved
  const effectiveLastHours = rangeOverride ? rangeOverride.lastHours : lastHours
  const effectiveInterval = rangeOverride ? rangeOverride.interval : interval

  const swr = useChartData<{
    event_time: string
    exception_code: number
    count: number
  }>({
    chartName: 'cancelled-queries',
    hostId,
    interval: effectiveInterval,
    lastHours: effectiveLastHours,
    refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
  })

  return (
    <ChartContainer
      swr={swr}
      title={title}
      className={className}
      chartClassName={chartClassName}
    >
      {(dataArray, sql, metadata) => {
        const codeSet = new Set<string>()
        const nestedData: Record<
          string,
          Record<string, number>
        > = Object.create(null)

        for (const item of dataArray) {
          const time = String(item.event_time ?? '')
          const code = labelForCode(String(item.exception_code ?? ''))
          const count = Number(item.count ?? 0)

          codeSet.add(code)

          if (nestedData[time] === undefined) {
            nestedData[time] = Object.create(null)
          }
          nestedData[time][code] = count
        }

        const exceptionCodes = Array.from(codeSet).sort()
        const chartData = Object.entries(nestedData).map(
          ([time, codeCounts]) => {
            const entry: Record<string, number | string> = { event_time: time }
            Object.entries(codeCounts).forEach(([code, count]) => {
              entry[code] = count
            })
            return entry
          }
        )

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={chartData}
            metadata={metadata}
            data-testid="cancelled-queries-chart"
            dateRangeConfig={DATE_RANGE_PRESETS.historical}
            currentRange={rangeOverride?.value}
            onRangeChange={setRangeOverride}
            contentClassName={chartCardContentClassName}
          >
            <BarChart
              className={cn('h-full w-full', chartClassName)}
              data={chartData}
              index="event_time"
              categories={exceptionCodes}
              showLegend
              stack
              {...props}
            />
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
})

export default ChartCancelledQueries
