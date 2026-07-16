import { ArrowDownToLine, Database, FileInput } from 'lucide-react'

import { memo } from 'react'
import { KpiCard } from '@/components/overview-charts/kpi-card'
import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface TrafficSummaryRow {
  rows_24h: number
  rows_prev_24h: number
  bytes_24h: number
  bytes_prev_24h: number
  inserts_24h: number
  inserts_prev_24h: number
  readable_rows_24h: string
  readable_bytes_24h: string
  readable_inserts_24h: string
  [key: string]: unknown
}

const DASH = '—'

/** "+12.3% vs prev 24h" delta line, or a neutral hint when there is no baseline. */
function deltaSub(current?: number, previous?: number) {
  const cur = Number(current ?? 0)
  const prev = Number(previous ?? 0)
  if (!prev) return 'last 24h'
  const pct = ((cur - prev) / prev) * 100
  const sign = pct >= 0 ? '+' : ''
  return (
    <span className={cn('tabular-nums', pct < 0 && 'text-muted-foreground')}>
      {sign}
      {pct.toFixed(1)}% vs prev 24h
    </span>
  )
}

/**
 * Ingestion KPI strip for /traffic: last-24h totals from system.query_log
 * with a delta against the previous 24h window.
 */
export const TrafficSummaryKpis = memo(function TrafficSummaryKpis({
  className,
}: {
  className?: string
}) {
  const hostId = useHostId()

  const summary = useChartData<TrafficSummaryRow>({
    chartName: 'traffic-summary',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  const s = summary.data?.[0]
  const hasData = !summary.error && !!s

  return (
    <div
      className={cn(
        'grid auto-rows-fr grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-3',
        className
      )}
    >
      <KpiCard
        icon={Database}
        tone="blue"
        label="Rows Ingested"
        value={hasData ? s!.readable_rows_24h || DASH : DASH}
        sub={hasData ? deltaSub(s!.rows_24h, s!.rows_prev_24h) : undefined}
        isLoading={summary.isLoading}
      />
      <KpiCard
        icon={ArrowDownToLine}
        tone="green"
        label="Data Ingested"
        value={hasData ? s!.readable_bytes_24h || DASH : DASH}
        sub={hasData ? deltaSub(s!.bytes_24h, s!.bytes_prev_24h) : undefined}
        isLoading={summary.isLoading}
      />
      <KpiCard
        icon={FileInput}
        tone="violet"
        label="Insert Queries"
        value={hasData ? s!.readable_inserts_24h || DASH : DASH}
        sub={
          hasData ? deltaSub(s!.inserts_24h, s!.inserts_prev_24h) : undefined
        }
        isLoading={summary.isLoading}
      />
    </div>
  )
})

export default TrafficSummaryKpis
