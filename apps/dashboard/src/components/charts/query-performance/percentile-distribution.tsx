import { BarChart } from '@/components/charts/primitives/bar/bar'
import { cn } from '@/lib/utils'

/** A single row returned by the `*-distribution` chart builders: p10..p99 of one metric. */
export interface PercentileRow {
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
}

const PERCENTILE_KEYS = [
  'p10',
  'p25',
  'p50',
  'p75',
  'p90',
  'p95',
  'p99',
] as const

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md border bg-muted/40 px-3 py-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums">
        {value}
      </span>
    </div>
  )
}

/**
 * Shared render body for the four Query Insights distribution tiles
 * (duration, memory, read rows, read bytes): p50/p95/p99 stat chips above
 * a bar chart of the p10/p25/p50/p75/p90/p95/p99 percentile curve.
 */
export function PercentileDistribution({
  row,
  formatValue,
  barColor = '--chart-2',
  className,
  emptyMessage = 'No query activity recorded',
}: {
  row: PercentileRow | undefined
  formatValue: (value: number) => string
  barColor?: string
  className?: string
  emptyMessage?: string
}) {
  if (!row) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  const bars = PERCENTILE_KEYS.map((key) => ({
    percentile: key.toUpperCase(),
    value: row[key] ?? 0,
  }))

  return (
    <div className={cn('flex h-full flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <StatChip label="p50" value={formatValue(row.p50 ?? 0)} />
        <StatChip label="p95" value={formatValue(row.p95 ?? 0)} />
        <StatChip label="p99" value={formatValue(row.p99 ?? 0)} />
      </div>
      <BarChart
        className="min-h-[120px] flex-1"
        data={bars}
        index="percentile"
        categories={['value']}
        colors={[barColor]}
        yAxisTickFormatter={(v) => formatValue(Number(v))}
      />
    </div>
  )
}
