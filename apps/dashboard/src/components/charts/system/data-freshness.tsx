import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { RankBars } from '@/components/charts/primitives/rank-bars'
import { useChartData } from '@/lib/swr'

type DataRow = {
  table_path: string
  staleness_seconds: number
  readable_staleness: string
  active_parts: number
  readable_rows: string
}

/** Color by age: green if fresh, amber if a day old, rose if stale */
function ageColor(seconds: number): string {
  if (seconds < 3600) return 'var(--color-emerald-500, oklch(0.72 0.19 152))'
  if (seconds < 86400) return 'var(--color-amber-500, oklch(0.77 0.17 70))'
  return 'var(--color-rose-500, oklch(0.65 0.22 27))'
}

export const ChartDataFreshness = function ChartDataFreshness({
  title,
  className,
  hostId,
}: ChartProps) {
  const swr = useChartData<DataRow>({
    chartName: 'data-freshness',
    hostId,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(dataArray, sql, metadata) => {
        const rows = dataArray as DataRow[]

        const max = Math.max(...rows.map((r) => r.staleness_seconds), 0.0001)
        const items = rows.map((row) => ({
          label: row.table_path,
          value: row.readable_staleness,
          pct: Math.max(4, (row.staleness_seconds / max) * 100),
          color: ageColor(row.staleness_seconds),
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
              <div className="flex items-center justify-end text-[11px] text-muted-foreground">
                since last insert
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

export default ChartDataFreshness
