'use client'

import { Minus, Plus } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * A numeric threshold control: a labelled value with −/+ steppers on either
 * side, tinted by severity.
 *
 * Replaces the raw `<input type="number">` pairs the Thresholds tab used to
 * render. The step is derived from the value's magnitude, so nudging a "150
 * parts" threshold moves in tens while a "3 replicas" one moves by one — the
 * native spinner's fixed step of 1 made large thresholds unusable.
 *
 * A wrapper, not an edit to `components/ui/input.tsx`.
 */
export function ThresholdField({
  id,
  label,
  value,
  onChange,
  tone,
  hint,
  disabled,
}: {
  id: string
  label: string
  value: number
  onChange: (next: number) => void
  tone: 'warning' | 'critical'
  /** Unit or short helper text shown under the control. */
  hint?: string
  disabled?: boolean
}) {
  const step = stepFor(value)
  const nudge = (direction: 1 | -1) =>
    onChange(Math.max(0, round(value + direction * step)))

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-2 rounded-full',
            tone === 'critical' ? 'bg-chart-red' : 'bg-chart-yellow'
          )}
          aria-hidden="true"
        />
        <label
          htmlFor={id}
          className="text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
      </div>
      <div className="flex items-center gap-1">
        <StepperButton
          label={`Decrease ${label}`}
          onClick={() => nudge(-1)}
          disabled={disabled || value <= 0}
        >
          <Minus className="size-3.5" strokeWidth={1.5} />
        </StepperButton>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = Number(e.target.value)
            if (Number.isFinite(next)) onChange(next)
          }}
          className="h-8 text-center text-[13px] font-medium tabular-nums"
        />
        <StepperButton
          label={`Increase ${label}`}
          onClick={() => nudge(1)}
          disabled={disabled}
        >
          <Plus className="size-3.5" strokeWidth={1.5} />
        </StepperButton>
      </div>
      {hint && (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      )}
    </div>
  )
}

function StepperButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground',
        'transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
      )}
    >
      {children}
    </button>
  )
}

/** Step proportional to magnitude: 0.1 / 1 / 5 / 10 / 50 / 100. */
function stepFor(value: number): number {
  const v = Math.abs(value)
  if (v < 1) return 0.1
  if (v < 10) return 1
  if (v < 50) return 5
  if (v < 200) return 10
  if (v < 1000) return 50
  return 100
}

/** Keep float steps from accumulating 0.30000000000000004-style drift. */
function round(value: number): number {
  return Number(value.toFixed(2))
}
