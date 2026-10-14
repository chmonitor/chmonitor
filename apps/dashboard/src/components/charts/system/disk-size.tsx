import type { ChartProps } from '@/components/charts/chart-props'

import { createCustomChart } from '@/components/charts/factory'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface DiskRow {
  name: string
  path?: string
  used_space: number
  readable_used_space: string
  unreserved_space?: number
  readable_unreserved_space?: string
  free_space: number
  readable_free_space: string
  total_space: number
  readable_total_space: string
  percent_free?: number
  keep_free_space?: number
  type?: string
}

function usedPct(row: DiskRow): number {
  if (!row.total_space) return 0
  return Math.min(100, (row.used_space / row.total_space) * 100)
}

function pctColor(pct: number): string {
  if (pct >= 90) return 'bg-rose-500'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function UsageBadge({ pct }: { pct: number }) {
  const label = `${Math.round(pct)}% used`
  if (pct >= 90)
    return (
      <Badge className="border-transparent bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
        {label}
      </Badge>
    )
  if (pct >= 70)
    return (
      <Badge className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        {label}
      </Badge>
    )
  return <Badge variant="secondary">{label}</Badge>
}

export const ChartDiskSize = createCustomChart({
  chartName: 'disk-size',
  dataTestId: 'disk-size-chart',
  render: (dataArray) => {
    const rows = dataArray as DiskRow[]
    if (!rows.length) return null

    // Primary disk: prefer the one named "default", fall back to largest by total_space
    const primary =
      rows.find((r) => r.name === 'default') ??
      rows.reduce((a, b) => (a.total_space >= b.total_space ? a : b))

    const primaryPct = usedPct(primary)

    // Parse readable_used_space: split the number from the unit suffix
    const usedParts = primary.readable_used_space.split(' ')
    const usedNumber = usedParts[0] ?? primary.readable_used_space
    const usedUnit = usedParts.slice(1).join(' ') || ''

    return (
      <div className="flex flex-col gap-0">
        {/* Headline row: big number + badge */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-semibold tracking-tight">
              {usedNumber}
            </span>
            <span className="text-sm text-muted-foreground">
              {usedUnit} used
            </span>
          </div>
          <UsageBadge pct={primaryPct} />
        </div>

        {/* Subline */}
        <p className="mt-0.5 text-xs text-muted-foreground">
          of {primary.readable_total_space} total &middot;{' '}
          <span className="font-mono">default</span> policy &middot;{' '}
          {primary.readable_free_space} free
        </p>

        {/* Overall progress bar */}
        <div className="mt-3.5 mb-4">
          <Progress
            value={primaryPct}
            aria-label={`${primary.name} disk usage`}
            className={cn('h-2.5 bg-muted', {
              '[&>div]:bg-rose-500': primaryPct >= 90,
              '[&>div]:bg-amber-500': primaryPct >= 70 && primaryPct < 90,
              '[&>div]:bg-emerald-500': primaryPct < 70,
            })}
          />
        </div>

        {/* Per-disk rows */}
        <div className="flex flex-col">
          {rows.map((row) => {
            const pct = usedPct(row)
            const colorClass = pctColor(pct)
            return (
              <div
                key={row.name}
                className="flex flex-col gap-1.5 border-t border-border py-2.5"
              >
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-[7px] shrink-0 rounded-full',
                        colorClass
                      )}
                    />
                    <span className="font-semibold">{row.name}</span>
                    {row.type ? (
                      <Badge
                        variant="secondary"
                        className="rounded-md px-1.5 py-0 text-[10px]"
                      >
                        {row.type}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {row.readable_used_space} / {row.readable_total_space}{' '}
                    &middot; {Math.round(pct)}%
                  </span>
                </div>
                {/* Thin per-disk track */}
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full', colorClass)}
                    style={{ width: `${pct.toFixed(1)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  },
})

export type ChartDiskSizeProps = ChartProps

export default ChartDiskSize
