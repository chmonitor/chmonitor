import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { memo, useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { resolveDateRangeConfig } from '@/components/date-range'
import { transformUserEventCounts } from '@/lib/chart-data-transforms'
import { useChartData } from '@/lib/swr'
import { chartTickFormatters, cn } from '@/lib/utils'

export const ChartQueryCountByUser = memo(function ChartQueryCountByUser({
  title = 'Total Queries by users',
  interval = 'toStartOfDay',
  lastHours = 24 * 14,
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
    user: string
    count: number
  }>({
    chartName: 'query-count-by-user',
    hostId,
    interval: effectiveInterval,
    lastHours: effectiveLastHours,
  })

  // Resolve date range config
  const dateRangeConfig = resolveDateRangeConfig('query-activity')

  return (
    <ChartContainer
      swr={swr}
      title={title}
      className={className}
      chartClassName={chartClassName}
    >
      {(dataArray, sql, metadata, staleError, mutate) => {
        const { chartData, users } = transformUserEventCounts(dataArray)

        return (
          <ChartCard
            title={title}
            sql={sql}
            data={chartData}
            metadata={metadata}
            dateRangeConfig={dateRangeConfig}
            currentRange={rangeOverride?.value}
            onRangeChange={setRangeOverride}
            staleError={staleError}
            onRetry={mutate}
            contentClassName={chartCardContentClassName}
            data-testid="query-count-by-user-chart"
          >
            <BarChart
              className={cn('h-full w-full', chartClassName)}
              data={chartData}
              index="event_time"
              categories={users}
              colors={[
                '--chart-1',
                '--chart-2',
                '--chart-3',
                '--chart-4',
                '--chart-5',
                '--chart-6',
                '--chart-7',
                '--chart-8',
              ]}
              showLegend
              stack
              yAxisTickFormatter={chartTickFormatters.count}
              {...props}
            />
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
})

export default ChartQueryCountByUser
