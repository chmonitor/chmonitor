import type { ChartProps } from '@/components/charts/chart-props'

import { createCustomChart } from '@/components/charts/factory'
import { DiskUsageBar, usageLevel } from '@/components/disks/disk-usage-bar'
import { formatReadableSize } from '@/lib/format-readable'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { cn } from '@/lib/utils'

// ============================================================================
// ChartDiskUsage — multi-disk breakdown card for the overview tab grid
// ============================================================================

/**
 * Lists every disk reported by `system.disks` with a per-disk usage bar, the
 * raw engine type, and `used / total` + free figures, topped by an aggregate
 * summary. Built on {@link createCustomChart} so the card chrome (title, SQL
 * toolbar, href, loading/error/empty) comes from ChartCard/ChartContainer —
 * matching every other chart in the overview tab grid.
 *
 * Reuses {@link usageLevel}/{@link DiskUsageBar} so threshold colors stay in
 * sync with the /disks detail page (90% critical, 75% warn).
 */

type DiskRow = {
  name: string
  type?: string
  used_space: number
  readable_used_space: string
  total_space: number
  readable_total_space: string
  free_space: number
  readable_free_space: string
}

type UsageLevel = ReturnType<typeof usageLevel>

/** Dot + percent accent, matching DiskUsageBar's fill color per level. */
const LEVEL_ACCENT: Record<UsageLevel, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
}

const LEVEL_DOT: Record<UsageLevel, string> = {
  ok: 'bg-emerald-500 dark:bg-emerald-400',
  warn: 'bg-amber-500 dark:bg-amber-400',
  critical: 'bg-red-500 dark:bg-red-400',
}

function percentUsed(used: number, total: number): number {
  return total > 0 ? Math.min(100, (used / total) * 100) : 0
}

function DiskRowItem({ disk }: { disk: DiskRow }) {
  const pct = percentUsed(disk.used_space, disk.total_space)
  const level = usageLevel(pct)

  return (
    <div className="flex flex-col gap-1 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn('size-2 shrink-0 rounded-full', LEVEL_DOT[level])}
            aria-hidden
          />
          <span className="truncate text-[13px] font-semibold leading-none">
            {disk.name}
          </span>
          {disk.type ? (
            <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {disk.type}
            </span>
          ) : null}
        </div>
        <span
          className={cn(
            'shrink-0 font-mono text-[13px] font-semibold tabular-nums',
            LEVEL_ACCENT[level]
          )}
        >
          {pct.toFixed(0)}%
        </span>
      </div>

      <DiskUsageBar percentUsed={pct} className="h-2" />

      <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>
          {disk.readable_used_space} / {disk.readable_total_space}
        </span>
        <span>{disk.readable_free_space} free</span>
      </div>
    </div>
  )
}

function DiskUsageContent({ disks }: { disks: DiskRow[] }) {
  const usedSum = disks.reduce((acc, d) => acc + d.used_space, 0)
  const totalSum = disks.reduce((acc, d) => acc + d.total_space, 0)
  // Sum the native free_space column so the header total matches the sum of the
  // per-disk "free" figures (these differ from total-used when keep_free_space
  // reservations apply).
  const freeSum = disks.reduce((acc, d) => acc + d.free_space, 0)
  const totalPct = percentUsed(usedSum, totalSum)

  return (
    <div className="flex flex-col">
      {/* Aggregate summary */}
      <div className="flex items-baseline justify-between gap-2 pb-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span className="text-[13px] font-semibold tabular-nums text-foreground/90">
          {formatReadableSize(usedSum)}
          <span className="font-normal text-muted-foreground">
            {' '}
            / {formatReadableSize(totalSum)}
          </span>
        </span>
        <span>
          {formatReadableSize(freeSum)} free · {totalPct.toFixed(0)}% used
        </span>
      </div>

      {/* Per-disk rows — card is row-span-2 so all disks show without scrolling */}
      <div className="flex flex-col">
        {disks.map((disk) => (
          <DiskRowItem key={disk.name} disk={disk} />
        ))}
      </div>
    </div>
  )
}

export const ChartDiskUsage = createCustomChart({
  chartName: 'disk-size-all',
  defaultTitle: 'Disk Usage',
  dataTestId: 'disk-usage-chart',
  refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  contentClassName: 'flex flex-col',
  render: (data) => <DiskUsageContent disks={data as DiskRow[]} />,
})

export type ChartDiskUsageProps = ChartProps

export default ChartDiskUsage
