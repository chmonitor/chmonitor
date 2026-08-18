import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'

import { memo, useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { resolveDateRangeConfig } from '@/components/date-range'
import { useChartData } from '@/lib/swr'
import { chartTickFormatters } from '@/lib/utils'

interface FingerprintRow {
  [key: string]: unknown
  event_time: string
  hash: string
  query_preview: string
  count: number
}

/**
 * Pivots fingerprint rows into wide-form chart data.
 * Groups by event_time, with each unique hash as a separate series.
 * Uses truncated query_preview as legend labels.
 */
function pivotFingerprints(data: readonly FingerprintRow[]) {
  const labelMap = new Map<string, string>()
  const timeMap = new Map<string, Record<string, number | string>>()

  for (const row of data) {
    const hash = String(row.hash)
    if (!labelMap.has(hash)) {
      const preview = String(row.query_preview || hash).slice(0, 50)
      // Append short hash suffix to disambiguate collisions
      const hashSuffix = hash.slice(0, 6)
      const label = `${preview} (${hashSuffix})`
      labelMap.set(hash, label)
    }

    const time = String(row.event_time)
    if (!timeMap.has(time)) {
      timeMap.set(time, { event_time: time })
    }
    const entry = timeMap.get(time)!
    const label = labelMap.get(hash)!
    entry[label] = Number(row.count)
  }

  const series = Array.from(labelMap.values())
  const chartData = Array.from(timeMap.values())

  return { chartData, series }
}

export const ChartTopQueryFingerprints = memo(
  function ChartTopQueryFingerprints({
    title = 'Top Query Patterns',
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
    className,
    chartClassName,
    hostId,
    ...props
  }: ChartProps) {
    const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
      null
    )

    const effectiveLastHours = rangeOverride?.lastHours ?? lastHours
    const effectiveInterval = rangeOverride?.interval ?? interval

    const swr = useChartData<FingerprintRow>({
      chartName: 'top-query-fingerprints',
      hostId,
      interval: effectiveInterval,
      lastHours: effectiveLastHours,
    })

    const dateRangeConfig = resolveDateRangeConfig('query-activity')

    return (
      <ChartContainer
        swr={swr}
        title={title}
        className={className}
        chartClassName={chartClassName}
      >
        {(dataArray, sql, metadata, staleError, mutate) => {
          const { chartData, series } = pivotFingerprints(
            dataArray as FingerprintRow[]
          )

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
              onRetry={() => mutate()}
              data-testid="top-query-fingerprints-chart"
            >
              <BarChart
                className={chartClassName}
                data={chartData}
                index="event_time"
                categories={series}
                colors={[
                  '--chart-1',
                  '--chart-2',
                  '--chart-3',
                  '--chart-4',
                  '--chart-5',
                  '--chart-6',
                  '--chart-7',
                  '--chart-8',
                  '--chart-9',
                  '--chart-10',
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
  }
)

export default ChartTopQueryFingerprints
