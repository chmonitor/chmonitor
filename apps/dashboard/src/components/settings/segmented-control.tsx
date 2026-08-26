import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Example value shown under the label (e.g. "1.5 GiB"). */
  description?: string
  icon?: LucideIcon
}

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  ariaLabel: string
}

/**
 * A compact segmented button group for mutually exclusive choices, styled
 * to match the theme picker's card look. Two or three options stay on one
 * row; four or more wrap (2 / 3 / 5 columns) so Navigation's five workspace
 * presets fit a narrow Settings pane.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const columnsClass =
    options.length <= 2
      ? 'grid-cols-2'
      : options.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('grid gap-2', columnsClass)}
    >
      {options.map((option) => {
        const Icon = option.icon
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 p-2.5 transition-[opacity,border-color,background-color,box-shadow] hover:opacity-80 focus-visible:opacity-80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              isSelected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-muted bg-muted/20'
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            <span className="text-xs font-medium">{option.label}</span>
            {option.description && (
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {option.description}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
