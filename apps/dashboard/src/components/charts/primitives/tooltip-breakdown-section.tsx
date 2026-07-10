/**
 * Breakdown section component for tooltips
 */

import { TooltipColorIndicator } from './tooltip-color-indicator'

/** Value of a breakdown entry as produced by `parseBreakdownData`. */
export type BreakdownValue = number | string | null | undefined

export interface BreakdownSectionProps {
  breakdownData: Array<[string, BreakdownValue]>
  heading: string
  /** Recharts tooltip item; only the optional `breakdownLabel` field is read from it. */
  item: unknown
  breakdownLabel?: string
}

/**
 * Color token for the breakdown dot at `index`.
 *
 * Mirrors the series color fallback in `primitives/area.tsx`
 * (`--chart-${index + 1}`, ascending) so each dot follows the same convention
 * as the series colors. Intentionally has no modulo: it stays identical to the
 * series arithmetic, which is unbounded past the defined `--chart-1..13`
 * tokens (pre-existing series behavior, tracked separately).
 */
export function breakdownColorVar(index: number): string {
  return `var(--chart-${index + 1})`
}

/**
 * Format a breakdown value for display without throwing on non-numbers.
 */
export function formatBreakdownValue(value: BreakdownValue): string {
  return typeof value === 'number'
    ? value.toLocaleString()
    : String(value ?? '')
}

/**
 * Breakdown section with detailed items
 *
 * Displays a list of breakdown items with color indicators and values.
 */
export function BreakdownSection({
  breakdownData,
  heading,
  item,
  breakdownLabel,
}: BreakdownSectionProps) {
  return (
    <div
      className="text-foreground flex basis-full flex-col border-t pt-2 text-xs font-medium"
      data-role="breakdown"
    >
      <div className="mb-1.5">{heading}</div>
      <div className="flex flex-col gap-1.5">
        {breakdownData.map(([name, value], index) => (
          <BreakdownRow
            key={name + index}
            name={name}
            value={value}
            index={index}
            item={item}
            breakdownLabel={breakdownLabel}
          />
        ))}
      </div>
    </div>
  )
}

interface BreakdownRowProps {
  name: string
  value: BreakdownValue
  index: number
  item: unknown
  breakdownLabel?: string
}

/**
 * Individual breakdown row
 */
function BreakdownRow({
  name,
  value,
  index,
  item,
  breakdownLabel,
}: BreakdownRowProps) {
  const rawLabel =
    breakdownLabel && item && typeof item === 'object'
      ? (item as Record<string, unknown>)[breakdownLabel]
      : undefined
  const label =
    (typeof rawLabel === 'string' || typeof rawLabel === 'number') && rawLabel
      ? String(rawLabel)
      : name

  return (
    <div className="flex items-center justify-between gap-2" role="row">
      <div className="flex items-center gap-1.5 min-w-0">
        <TooltipColorIndicator
          colorVar={breakdownColorVar(index)}
          size="small"
        />
        <span className="truncate">{label}</span>
      </div>

      <div className="text-foreground shrink-0 flex items-baseline gap-0.5 font-mono font-medium tabular-nums">
        {formatBreakdownValue(value)}
      </div>
    </div>
  )
}
