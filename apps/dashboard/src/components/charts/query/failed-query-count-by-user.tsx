import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { memo, useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { DATE_RANGE_PRESETS } from '@/components/date-range'
import { transformUserEventCounts } from '@/lib/chart-data-transforms'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

export const ChartFailedQueryCountByUser = memo(
  function ChartFailedQueryCountByUser({
    title,
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
    className,
    chartClassName,
    hostId,
    ...props
  }: ChartProps) {
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
      chartName: 'failed-query-count-by-user',
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
          const { chartData, users } = transformUserEventCounts(dataArray)

          return (
            <ChartCard
              title={title}
              className={className}
              sql={sql}
              data={chartData}
              metadata={metadata}
              data-testid="failed-query-count-by-user-chart"
              dateRangeConfig={DATE_RANGE_PRESETS.historical}
              currentRange={rangeOverride?.value}
              onRangeChange={setRangeOverride}
            >
              <BarChart
                className={chartClassName}
                data={chartData}
                index="event_time"
                categories={users}
                showLegend
                stack
                {...props}
              />
            </ChartCard>
          )
        }}
      </ChartContainer>
    )
  }
)

export default ChartFailedQueryCountByUser
