import type { ChartPalette } from '@/lib/types/user-settings'

import { cn } from '@/lib/utils'

const chartPaletteMeta: {
  value: ChartPalette
  label: string
  hint: string
}[] = [
  { value: 'default', label: 'Default', hint: 'Brand orange ramp' },
  {
    value: 'colorblind-safe',
    label: 'Colorblind',
    hint: 'Okabe–Ito distinct hues',
  },
  { value: 'monochrome', label: 'Mono', hint: 'Single-hue amber ramp' },
]

/**
 * Representative swatches for each chart palette so the user can see the
 * difference at a glance. Values mirror the `--chart-1..5` tokens defined in
 * `styles.css` (default orange ramp, Okabe-Ito, single-hue ramp).
 */
const PALETTE_SWATCHES: Record<ChartPalette, string[]> = {
  default: ['#f5a524', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
  'colorblind-safe': ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2'],
  monochrome: ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f'],
}

const PALETTE_BAR_HEIGHTS = [38, 72, 48, 88, 60]

export function PalettePicker({
  value,
  onChange,
}: {
  value: ChartPalette
  onChange: (value: ChartPalette) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Chart palette"
      className="grid gap-2 sm:grid-cols-3"
    >
      {chartPaletteMeta.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-col gap-2 rounded-lg border-2 p-2.5 text-left transition-[opacity,border-color,background-color,box-shadow] hover:opacity-80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              isSelected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-muted bg-muted/20'
            )}
          >
            <div className="flex h-10 items-end gap-0.5">
              {PALETTE_SWATCHES[option.value].map((color, i) => (
                <span
                  key={`${option.value}-${i}`}
                  className="min-w-0 flex-1 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
                  style={{
                    backgroundColor: color,
                    height: `${PALETTE_BAR_HEIGHTS[i]}%`,
                  }}
                />
              ))}
            </div>
            <div className="space-y-0.5">
              <span className="block text-xs font-medium">{option.label}</span>
              <span className="block text-[11px] text-muted-foreground">
                {option.hint}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
