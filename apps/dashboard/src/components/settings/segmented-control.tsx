import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

interface SegmentedControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  ariaLabel: string
}

/**
 * A compact segmented button group for 2–3 mutually exclusive choices, styled
 * to match the theme picker's card look. Used across the Settings dialog for
 * unit / palette / density toggles.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
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
              'relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 p-2.5 transition-[opacity,border-color,background-color,box-shadow] hover:opacity-80',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              isSelected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-muted bg-muted/20'
            )}
          >
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            <span className="text-xs font-medium">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
