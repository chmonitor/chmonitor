import type { ChartProps } from '@/components/charts/chart-props'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { RankBars } from '@/components/charts/primitives/rank-bars'
import { SegmentedControl } from '@/components/filters/segmented-control'
import { ScrollArea } from '@/components/ui/scroll-area'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

type DataRow = {
  table: string
  compressed_bytes: number
  uncompressed_bytes: number
  compressed: string
  uncompressed: string
  compr_rate: number
  total_rows: number
  readable_total_rows: string
  part_count: number
}

const MODE_OPTIONS = [
  { label: 'Size', value: 'size' },
  { label: 'Rows', value: 'rows' },
]

export const ChartTopTableSize = function ChartTopTableSize({
  title,
  className,
  chartCardContentClassName,
  hostId,
}: ChartProps) {
  const limit = 7
  const [mode, setMode] = useState<'size' | 'rows'>('size')
  const swr = useChartData<DataRow>({
    chartName: 'top-table-size',
    hostId,
    params: { limit },
    refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(dataArray, sql, metadata) => {
        const max =
          mode === 'size'
            ? Math.max(
                ...dataArray.map((r) => r.compressed_bytes as number),
                0.0001
              )
            : Math.max(...dataArray.map((r) => r.total_rows as number), 0.0001)

        const items = dataArray.map((row) => {
          const v =
            mode === 'size'
              ? (row.compressed_bytes as number)
              : (row.total_rows as number)
          const display =
            mode === 'size'
              ? (row.compressed as string)
              : (row.readable_total_rows as string)
          return {
            label: row.table as string,
            value: display,
            pct: Math.max(4, (v / max) * 100),
            color: 'var(--chart-2)',
          }
        })

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={dataArray}
            metadata={metadata}
            data-testid="top-table-size-chart"
            contentClassName={chartCardContentClassName}
            headerControls={
              <SegmentedControl
                options={MODE_OPTIONS}
                value={mode}
                onChange={(v) => setMode(v as 'size' | 'rows')}
              />
            }
          >
            <ScrollArea className="h-full min-h-0">
              <RankBars items={items} />
            </ScrollArea>
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default ChartTopTableSize
