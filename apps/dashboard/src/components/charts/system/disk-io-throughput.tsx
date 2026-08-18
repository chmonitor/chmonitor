import type { ChartProps } from '@/components/charts/chart-props'
import type { ChartDataPoint } from '@/types/chart-data'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { AreaChart } from '@/components/charts/primitives/area'
import { pivotRows, type RawRow } from '@/lib/chart-utils'
import { useChartData, useHostId } from '@/lib/swr'
import { chartTickFormatters, cn, createDateTickFormatter } from '@/lib/utils'

const CHART_NAME = 'disk-io-throughput'
const DEFAULT_TITLE = 'Disk I/O Throughput'
const DEFAULT_INTERVAL = 'toStartOfFifteenMinutes'
const DEFAULT_LAST_HOURS = 24

export function ChartDiskIOThroughput({
  title = DEFAULT_TITLE,
  interval = DEFAULT_INTERVAL,
  lastHours = DEFAULT_LAST_HOURS,
  className,
  chartClassName,
  chartCardContentClassName,
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

  if (!swr.isLoading && !swr.error && pivoted.length === 0) {
    return (
      <ChartEmpty
        title={title}
        className={className}
        description="No disk I/O data recorded in this time period"
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
          data-testid="disk-io-throughput-chart"
          staleError={staleError}
          onRetry={mutate}
          contentClassName={chartCardContentClassName}
        >
          <AreaChart
            className={cn('h-full w-full', chartClassName)}
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

export type ChartDiskIOThroughputProps = ChartProps

export default ChartDiskIOThroughput
