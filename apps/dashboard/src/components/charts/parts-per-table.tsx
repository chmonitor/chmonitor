import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { RankBars } from '@/components/charts/primitives/rank-bars'
import { useChartData } from '@/lib/swr'

type DataRow = {
  table_path: string
  part_count: number
  readable_part_count: string
  total_rows: number
  readable_size: string
}

export const ChartPartsPerTable = function ChartPartsPerTable({
  title,
  className,
  hostId,
}: ChartProps) {
  const swr = useChartData<DataRow>({
    chartName: 'parts-per-table',
    hostId,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(rows, sql, metadata) => {
        const max = Math.max(...rows.map((r) => r.part_count), 0.0001)
        const items = rows.map((row) => ({
          label: row.table_path,
          value: row.readable_part_count,
          pct: Math.max(4, (row.part_count / max) * 100),
          color:
            row.part_count > 200
              ? 'var(--color-amber-500, oklch(0.77 0.17 70))'
              : 'var(--chart-2)',
        }))

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={rows}
            metadata={metadata}
            data-testid="parts-per-table-chart"
          >
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex items-center justify-end text-[11px] text-muted-foreground">
                active parts
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

export default ChartPartsPerTable
