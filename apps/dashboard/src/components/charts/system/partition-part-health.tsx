import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { useChartData } from '@/lib/swr'

type SummaryRow = {
  active_parts: number
  readable_active_parts: string
  outdated_parts: number
  partitions: number
  avg_parts_per_partition: number
}

function avgCaption(avg: number): string {
  if (avg >= 10) return `— approaching the merge threshold.`
  if (avg >= 5) return `— monitor merge queue closely.`
  return `— well within the merge threshold.`
}

export const ChartPartitionPartHealth = function ChartPartitionPartHealth({
  title,
  className,
  hostId,
}: ChartProps) {
  const swr = useChartData<SummaryRow>({
    chartName: 'partition-part-health-summary',
    hostId,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(dataArray, sql, metadata) => {
        const row = (dataArray as SummaryRow[])[0]
        if (!row) return null

        const total = row.active_parts + row.outdated_parts
        const healthyPct =
          total > 0 ? Math.round((row.active_parts / total) * 100) : 100
        const pendingPct = 100 - healthyPct

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={dataArray}
            metadata={metadata}
            data-testid="partition-part-health-chart"
          >
            {/* Stat triad */}
            <div className="flex gap-3.5 mb-4">
              <div className="flex-1">
                <div className="text-[28px] font-semibold tracking-tight font-mono leading-none">
                  {row.readable_active_parts}
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-1">
                  active parts
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[28px] font-semibold tracking-tight font-mono leading-none text-amber-500 dark:text-amber-400">
                  {row.outdated_parts.toLocaleString()}
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-1">
                  outdated
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[28px] font-semibold tracking-tight font-mono leading-none">
                  {row.partitions.toLocaleString()}
                </div>
                <div className="text-[11.5px] text-muted-foreground mt-1">
                  partitions
                </div>
              </div>
            </div>

            {/* Segmented health bar */}
            <div className="h-[9px] rounded-full bg-muted overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 dark:bg-emerald-400"
                style={{ width: `${healthyPct}%` }}
              />
              {pendingPct > 0 && (
                <div
                  className="h-full bg-amber-500 dark:bg-amber-400"
                  style={{ width: `${pendingPct}%` }}
                />
              )}
            </div>

            {/* Legend */}
            <div className="flex justify-between mt-[9px] text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-[7px] h-[7px] rounded-full bg-emerald-500 dark:bg-emerald-400" />
                {healthyPct}% healthy
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-[7px] h-[7px] rounded-full bg-amber-500 dark:bg-amber-400" />
                {pendingPct}% pending cleanup
              </span>
            </div>

            {/* Caption */}
            <div className="mt-auto pt-4 text-[12px] text-muted-foreground leading-relaxed">
              Avg{' '}
              <span className="font-mono font-semibold text-foreground">
                {row.avg_parts_per_partition}
              </span>{' '}
              parts per partition {avgCaption(row.avg_parts_per_partition)}
            </div>
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default ChartPartitionPartHealth
