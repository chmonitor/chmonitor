import type { ChartProps } from '@/components/charts/chart-props'

import { useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { RankBars } from '@/components/charts/primitives/rank-bars'
import { SegmentedControl } from '@/components/filters/segmented-control'
import { useChartData } from '@/lib/swr'

type DataRow = {
  database: string
  total_bytes: number
  readable_size: string
  total_rows: number
  readable_rows: string
  part_count: number
}

const MODE_OPTIONS = [
  { label: 'Size', value: 'size' },
  { label: 'Rows', value: 'rows' },
]

export const ChartDiskUsageByDatabase = function ChartDiskUsageByDatabase({
  title,
  className,
  hostId,
}: ChartProps) {
  const [mode, setMode] = useState<'size' | 'rows'>('size')
  const swr = useChartData<DataRow>({
    chartName: 'disk-usage-by-database',
    hostId,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(rows, sql, metadata, staleError, mutate) => {
        const max =
          mode === 'size'
            ? Math.max(...rows.map((r) => r.total_bytes), 0.0001)
            : Math.max(...rows.map((r) => r.total_rows), 0.0001)

        const items = rows.map((row) => {
          const v = mode === 'size' ? row.total_bytes : row.total_rows
          const display =
            mode === 'size' ? row.readable_size : row.readable_rows
          return {
            label: row.database,
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
            data={rows}
            metadata={metadata}
            data-testid="disk-usage-by-database-chart"
            staleError={staleError}
            onRetry={mutate}
          >
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex items-center justify-end">
                <SegmentedControl
                  options={MODE_OPTIONS}
                  value={mode}
                  onChange={(v) => setMode(v as 'size' | 'rows')}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <RankBars items={items} />
              </div>
            </div>
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default ChartDiskUsageByDatabase
