import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { resolveDateRangeConfig } from '@/components/date-range'
import { REFRESH_INTERVAL, useChartData, useHostId } from '@/lib/swr'
import { chartTickFormatters, cn } from '@/lib/utils'

interface PeerdbBytesRow {
  event_time: string
  table: string
  peerdb_bytes: number
  [key: string]: unknown
}

/**
 * PeerDB bytes ingested over time, stacked per destination table — the
 * uncompressed payload companion to ChartPeerdbRowsOverTime. Categories are
 * derived dynamically from the data (one bar series per table), so it uses the
 * ChartContainer + pivot pattern rather than the static-categories factory.
 */
export const ChartPeerdbBytesOverTime = function ChartPeerdbBytesOverTime({
  title = 'PeerDB Bytes Ingested',
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

  // Fall back to the route's ?host like the factory charts do — the section
  // wrapper does not pass hostId, and omitting it silently queries host 0.
  const routeHostId = useHostId()
  const resolvedHostId = hostId ?? routeHostId

  const swr = useChartData<PeerdbBytesRow>({
    chartName: 'traffic-peerdb-bytes',
    hostId: resolvedHostId,
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
        // Pivot long rows (event_time, table, peerdb_bytes) into wide rows
        // keyed on event_time with one column per table.
        const tableSet = new Set<string>()
        const pivoted = dataArray.reduce<
          Record<string, Record<string, number>>
        >((acc, cur) => {
          const { event_time, table, peerdb_bytes } = cur as PeerdbBytesRow
          tableSet.add(table)
          const inner = acc[event_time] ?? {}
          inner[table] = peerdb_bytes
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
            data-testid="traffic-peerdb-bytes-chart"
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
              yAxisTickFormatter={chartTickFormatters.bytes}
              {...props}
            />
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default ChartPeerdbBytesOverTime
