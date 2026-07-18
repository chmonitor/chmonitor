import { ArrowDownToLine, Database, FileInput, Shrink } from 'lucide-react'

import { memo } from 'react'
import { KpiCard } from '@/components/overview-charts/kpi-card'
import { useTimeRange } from '@/lib/context/time-range-context'
import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface TrafficSummaryRow {
  rows_cur: number
  rows_prev: number
  bytes_cur: number
  bytes_prev: number
  inserts_cur: number
  inserts_prev: number
  readable_rows: string
  readable_bytes: string
  readable_inserts: string
  [key: string]: unknown
}

interface TrafficCompressionRow {
  compressed_bytes: number
  uncompressed_bytes: number
  compression_ratio: number
  readable_compressed_bytes: string
  readable_uncompressed_bytes: string
  [key: string]: unknown
}

const DASH = '—'

/** "+12.3% vs prev <range>" delta line, or a neutral hint when there is no baseline. */
function deltaSub(rangeLabel: string, current?: number, previous?: number) {
  const cur = Number(current ?? 0)
  const prev = Number(previous ?? 0)
  if (!prev) return `last ${rangeLabel}`
  const pct = ((cur - prev) / prev) * 100
  const sign = pct >= 0 ? '+' : ''
  return (
    <span className={cn('tabular-nums', pct < 0 && 'text-muted-foreground')}>
      {sign}
      {pct.toFixed(1)}% vs prev {rangeLabel}
    </span>
  )
}

/**
 * Ingestion KPI strip for /traffic: totals from system.query_log over the
 * globally selected time range, with a delta against the previous window of
 * the same length.
 */
export const TrafficSummaryKpis = memo(function TrafficSummaryKpis({
  className,
}: {
  className?: string
}) {
  const hostId = useHostId()
  const { timeRange } = useTimeRange()

  const summary = useChartData<TrafficSummaryRow>({
    chartName: 'traffic-summary',
    hostId,
    lastHours: timeRange.lastHours,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  const compression = useChartData<TrafficCompressionRow>({
    chartName: 'traffic-compression',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  const s = summary.data?.[0]
  const hasData = !summary.error && !!s
  const c = compression.data?.[0]
  const hasCompression = !compression.error && !!c && !!c.compression_ratio
  const rangeLabel = timeRange.label

  return (
    <div
      className={cn(
        'grid auto-rows-fr grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
    >
      <KpiCard
        icon={Database}
        tone="blue"
        label="Rows Ingested"
        value={hasData ? s!.readable_rows || DASH : DASH}
        sub={
          hasData ? deltaSub(rangeLabel, s!.rows_cur, s!.rows_prev) : undefined
        }
        isLoading={summary.isLoading}
      />
      <KpiCard
        icon={ArrowDownToLine}
        tone="green"
        label="Data Ingested"
        value={hasData ? s!.readable_bytes || DASH : DASH}
        sub={
          hasData
            ? deltaSub(rangeLabel, s!.bytes_cur, s!.bytes_prev)
            : undefined
        }
        isLoading={summary.isLoading}
      />
      <KpiCard
        icon={FileInput}
        tone="violet"
        label="Insert Queries"
        value={hasData ? s!.readable_inserts || DASH : DASH}
        sub={
          hasData
            ? deltaSub(rangeLabel, s!.inserts_cur, s!.inserts_prev)
            : undefined
        }
        isLoading={summary.isLoading}
      />
      <KpiCard
        icon={Shrink}
        tone="amber"
        label="Compression"
        value={hasCompression ? `${c!.compression_ratio}×` : DASH}
        sub={
          hasCompression
            ? `${c!.readable_compressed_bytes} on disk of ${c!.readable_uncompressed_bytes}`
            : undefined
        }
        isLoading={compression.isLoading}
      />
    </div>
  )
})

export default TrafficSummaryKpis
