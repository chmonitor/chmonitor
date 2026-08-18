import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { useChartData } from '@/lib/swr'

type DataRow = {
  normalized_query_hash: string
  query_preview: string
  execution_count: number
  readable_count: string
  avg_duration_ms: number
  p95_duration_ms: number
  total_read_rows: number
  readable_read_rows: string
  total_memory: number
  readable_memory: string
}

export const ChartTopQueryFingerprints = function ChartTopQueryFingerprints({
  title,
  className,
  hostId,
}: ChartProps) {
  const swr = useChartData<DataRow>({
    chartName: 'top-query-fingerprints-perf',
    hostId,
  })

  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(dataArray, sql, metadata, staleError, mutate) => {
        const rows = dataArray as DataRow[]

        return (
          <ChartCard
            title={title}
            className={className}
            sql={sql}
            data={rows}
            metadata={metadata}
            data-testid="top-query-fingerprints-chart"
            staleError={staleError}
            onRetry={mutate}
          >
            <div className="flex flex-col gap-1">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 border-b pb-1 text-xs font-medium text-muted-foreground">
                <span>Query</span>
                <span className="w-16 text-right">Count</span>
                <span className="w-20 text-right">Avg (ms)</span>
                <span className="w-20 text-right">P95 (ms)</span>
                <span className="w-20 text-right">Memory</span>
              </div>

              {/* Rows */}
              {rows.map((row) => (
                <div
                  key={row.normalized_query_hash}
                  className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 py-1 text-xs hover:bg-muted/50 rounded"
                >
                  <span
                    className="truncate font-mono text-muted-foreground"
                    title={row.query_preview}
                  >
                    {row.query_preview}
                  </span>
                  <span className="w-16 text-right tabular-nums">
                    {row.readable_count}
                  </span>
                  <span className="w-20 text-right tabular-nums">
                    {row.avg_duration_ms}
                  </span>
                  <span className="w-20 text-right tabular-nums">
                    {row.p95_duration_ms}
                  </span>
                  <span className="w-20 text-right tabular-nums">
                    {row.readable_memory}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export default ChartTopQueryFingerprints
