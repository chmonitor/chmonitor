import { CHART_BG_CLASSES } from '@/components/charts/chart-bg-classes'
import { cn } from '@/lib/utils'

export interface ProportionItem {
  label: string
  value: number
  /** Tailwind bg-* class or CSS-var class, e.g. "bg-emerald-500" or "bg-chart-1" */
  colorClass?: string
}

export interface ProportionListProps {
  items: ProportionItem[]
  /** Pre-computed total; defaults to sum of all item values */
  total?: number
  /** Custom value formatter; defaults to toLocaleString */
  formatValue?: (value: number) => string
  /** Shown when items is empty */
  emptyMessage?: string
  className?: string
}

/**
 * Renders a vertical list of labelled progress-bar rows.
 * Each row shows: label | track+fill | count (pct%).
 * Percentages are computed from `total` (or the sum of all values).
 */
export function ProportionList({
  items,
  total,
  formatValue,
  emptyMessage = 'No data available',
  className,
}: ProportionListProps) {
  const computedTotal =
    total ?? items.reduce((sum, item) => sum + item.value, 0)

  const fmt = formatValue ?? ((v: number) => v.toLocaleString())

  if (items.length === 0) {
    return (
      <div className={cn('p-2', className)}>
        <p className="text-muted-foreground text-center text-sm">
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3 p-2', className)}>
      {items.map((item, index) => {
        const pct = computedTotal > 0 ? (item.value / computedTotal) * 100 : 0
        const fillClass =
          item.colorClass ?? CHART_BG_CLASSES[index % CHART_BG_CLASSES.length]

        return (
          <div key={item.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{item.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {fmt(item.value)} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  fillClass
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
