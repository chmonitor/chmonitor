import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { resolveDateRangeConfig } from '@/components/date-range'
import { useChartData } from '@/lib/swr'
import { cn } from '@/lib/utils'

export const ChartNewPartsCreated = function ChartNewPartsCreated({
  title = 'New Parts Created',
  interval = 'toStartOfHour',
  lastHours = 24,
  className,
  chartClassName,
  chartCardContentClassName,
  hostId,
  ...props
}: ChartProps) {
  // Date range state for user-selected time range
  const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
    null
  )

  // Use override values when date range is selected, otherwise use props/defaults
  const effectiveLastHours = rangeOverride?.lastHours ?? lastHours
  const effectiveInterval = rangeOverride?.interval ?? interval

  const swr = useChartData<{
    event_time: string
    table: string
    new_parts: number
  }>({
    chartName: 'new-parts-created',
    hostId,
    interval: effectiveInterval,
    lastHours: effectiveLastHours,
  })

  // Resolve date range config
  const dateRangeConfig = resolveDateRangeConfig('operations')

  return (
    <ChartContainer
      swr={swr}
      title={title}
      className={className}
      chartClassName={chartClassName}
    >
      {(dataArray, sql, metadata, staleError, mutate) => {
        // Type the data items properly
        type DataItem = { event_time: string; table: string; new_parts: number }

        // Single-pass algorithm: collect data and track tables simultaneously
        const tableSet = new Set<string>()
        const data = dataArray.reduce<Record<string, Record<string, number>>>(
          (acc, cur) => {
            const { event_time, table, new_parts } = cur as DataItem
            tableSet.add(table)
            if (acc[event_time] === undefined) {
              acc[event_time] = {}
            }

            const inner = acc[event_time] || {}
            inner[table] = new_parts
            acc[event_time] = inner
            return acc
          },
          {}
        )

        const barData = Object.entries(data).map(([event_time, obj]) => {
          return { event_time, ...obj }
        })

        // Convert set to array for categories
        const tables = Array.from(tableSet)

        const rangeLabel = (() => {
          const h = effectiveLastHours
          if (h <= 24) return 'Last 24h'
          return `Last ${Math.round(h / 24)}d`
        })()

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={barData}
            metadata={metadata}
            dateRangeConfig={dateRangeConfig}
            currentRange={rangeOverride?.value}
            onRangeChange={setRangeOverride}
            staleError={staleError}
            onRetry={mutate}
            contentClassName={chartCardContentClassName}
            data-testid="new-parts-created-chart"
          >
            <div className="flex justify-end mb-1">
              <span className="text-xs text-muted-foreground font-mono">
                {rangeLabel}
              </span>
            </div>
            <BarChart
              className={cn('h-full w-full', chartClassName)}
              data={barData}
              index="event_time"
              categories={tables}
              colors={[
                '--chart-2',
                '--chart-3',
                '--chart-1',
                '--chart-4',
                '--chart-5',
              ]}
              stack
              {...props}
            />
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default ChartNewPartsCreated
