import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { resolveDateRangeConfig } from '@/components/date-range'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface PeerdbRowsRow {
  event_time: string
  table: string
  peerdb_rows: number
  [key: string]: unknown
}

/**
 * PeerDB rows ingested over time, stacked per destination table. Categories are
 * derived dynamically from the data (one bar series per table), so it uses the
 * ChartContainer + pivot pattern rather than the static-categories factory.
 */
export const ChartPeerdbRowsOverTime = function ChartPeerdbRowsOverTime({
  title = 'PeerDB Rows Ingested',
  interval = 'toStartOfHour',
  lastHours = 24,
  className,
  chartClassName,
  chartCardContentClassName,
  hostId,
  ...props
}: ChartProps) {
  const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
    null
  )

  const effectiveLastHours = rangeOverride?.lastHours ?? lastHours
  const effectiveInterval = rangeOverride?.interval ?? interval

  const swr = useChartData<PeerdbRowsRow>({
    chartName: 'traffic-peerdb-rows',
    hostId,
    interval: effectiveInterval,
    lastHours: effectiveLastHours,
    refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
  })

  const dateRangeConfig = resolveDateRangeConfig('operations')

  return (
    <ChartContainer
      swr={swr}
      title={title}
      className={className}
      chartClassName={chartClassName}
    >
      {(dataArray, sql, metadata, staleError, mutate) => {
        // Pivot long rows (event_time, table, peerdb_rows) into wide rows keyed
        // on event_time with one column per table, tracking tables in one pass.
        const tableSet = new Set<string>()
        const pivoted = dataArray.reduce<
          Record<string, Record<string, number>>
        >((acc, cur) => {
          const { event_time, table, peerdb_rows } = cur as PeerdbRowsRow
          tableSet.add(table)
          const inner = acc[event_time] ?? {}
          inner[table] = peerdb_rows
          acc[event_time] = inner
          return acc
        }, {})

        const barData = Object.entries(pivoted).map(([event_time, obj]) => ({
          event_time,
          ...obj,
        }))
        const tables = Array.from(tableSet)

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
            data-testid="traffic-peerdb-rows-chart"
          >
            <BarChart
              className={cn('h-full w-full', chartClassName)}
              data={barData}
              index="event_time"
              categories={tables}
              colors={[
                '--chart-1',
                '--chart-2',
                '--chart-3',
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

export default ChartPeerdbRowsOverTime
