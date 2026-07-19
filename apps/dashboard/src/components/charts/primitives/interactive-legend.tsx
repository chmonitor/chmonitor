/**
 * InteractiveLegendContent — a clickable variant of shadcn's ChartLegendContent
 * (components/ui/chart.tsx stays untouched per project convention). Clicking a
 * legend item toggles that series' visibility; hidden items render dimmed with
 * a hollow swatch so they stay discoverable. Used by the area/bar primitives,
 * so every chart with `showLegend` gets show/hide-per-series for free.
 */

import type { DefaultLegendContentProps } from 'recharts'

import { useCallback, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Local hidden-series state for a chart. Returns the set plus a toggle and a
 * `hide(category)` test the chart uses on its Area/Bar `hide` prop.
 */
export function useHiddenSeries() {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden])

  return { hidden, toggle, isHidden }
}

export function InteractiveLegendContent({
  payload,
  verticalAlign = 'bottom',
  hidden,
  onToggle,
  className,
}: Pick<DefaultLegendContentProps, 'payload' | 'verticalAlign'> & {
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
  className?: string
}) {
  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-x-4 gap-y-1',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className
      )}
    >
      {payload
        .filter((item) => item.type !== 'none')
        .map((item, index) => {
          // Recharts puts the series dataKey in both `dataKey` and `value`;
          // chart configs label series by their category name, so the key
          // doubles as the display label (same as ChartLegendContent renders).
          const key = String(item.dataKey ?? item.value ?? `item-${index}`)
          const isHidden = hidden.has(key)
          const label = String(item.value ?? key)

          return (
            <button
              key={`${key}-${index}`}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={!isHidden}
              title={isHidden ? `Show ${key}` : `Hide ${key}`}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-opacity hover:bg-muted/60',
                isHidden && 'opacity-40'
              )}
            >
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={
                  isHidden
                    ? { boxShadow: `inset 0 0 0 1.5px ${item.color}` }
                    : { backgroundColor: item.color }
                }
              />
              <span className={cn(isHidden && 'line-through')}>{label}</span>
            </button>
          )
        })}
    </div>
  )
}
