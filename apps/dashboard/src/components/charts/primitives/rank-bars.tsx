import { cn } from '@/lib/utils'

export interface RankBarItem {
  label: string
  value: string
  pct: number
  /** CSS token or value, e.g. "var(--chart-2)" — applied to the dot and track fill */
  color?: string
}

export interface RankBarsProps {
  items: RankBarItem[]
  className?: string
}

const DEFAULT_COLOR = 'var(--chart-2)'

/**
 * Ranked horizontal-bar list.
 * Each row: label + value on top, thin rounded track bar below.
 * `pct` drives the fill width (0–100). Pass a pre-computed minimum of ~2–4
 * so tiny values still show a visible sliver.
 */
export function RankBars({ items, className }: RankBarsProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {items.map((item, i) => {
        const color = item.color ?? DEFAULT_COLOR
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate font-medium">{item.label}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {item.value}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${item.pct}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
