import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { RankBars } from '@/components/charts/primitives/rank-bars'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

type DataRow = {
  table_path: string
  compressed_size: string
  uncompressed_size: string
  compression_ratio: number
  readable_rows: string
}

export const ChartCompressionRatio = function ChartCompressionRatio({
  title,
  className,
  hostId,
}: ChartProps) {
  const swr = useChartData<DataRow>({
    chartName: 'compression-ratio',
    hostId,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(dataArray, sql, metadata) => {
        const rows = dataArray as DataRow[]

        // Sort ascending — lower ratio is better
        const sorted = [...rows].sort(
          (a, b) => a.compression_ratio - b.compression_ratio
        )
        const max = Math.max(...sorted.map((r) => r.compression_ratio), 0.0001)
        const items = sorted.map((row) => ({
          label: row.table_path,
          value: `${row.compression_ratio}×`,
          pct: Math.max(4, (row.compression_ratio / max) * 100),
          color: 'var(--chart-2)',
        }))

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={rows}
            metadata={metadata}
          >
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex items-center justify-end text-[11px] max-sm:text-xs text-muted-foreground">
                compressed / raw · lower is better
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

export default ChartCompressionRatio
