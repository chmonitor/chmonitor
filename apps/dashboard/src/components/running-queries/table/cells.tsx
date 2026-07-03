import { CheckCircle2 } from 'lucide-react'

import type { DerivedQuery } from './types'

import { cn } from '@/lib/utils'

/** Emerald "Done" completion color, shared by the badge and progress bar. */
const DONE_COLOR = 'hsl(158 64% 42%)'

/**
 * "Done" status pill for a query that finished while the user was inspecting
 * it. Mirrors the emerald pill on the Recently-completed table so a retained
 * row reads as intentionally finished, not as a live query.
 */
export function DoneBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      <CheckCircle2 className="size-3" />
      Done
    </span>
  )
}

/**
 * Progress cell — a determinate bar with `read / total` rows when the query
 * reports progress, or an indeterminate shimmer when only the row count is
 * known. Bar color shifts blue → green as the scan completes.
 *
 * When `done`, the query has left `system.processes`: render a full emerald bar
 * labelled "Done" as a completion marker (the `read / total` subtext stays the
 * last-known counts — it is not a claim that every row was read).
 */
export function ProgressCell({ d, done }: { d: DerivedQuery; done?: boolean }) {
  const { pct } = d
  const indeterminate = pct == null && d.readRows > 0
  const label = done
    ? 'Done'
    : pct != null
      ? `${pct}%`
      : indeterminate
        ? 'Reading…'
        : '—'
  const denom =
    d.totalRows > 0 ? d.readableTotalRows : indeterminate ? '?' : '—'
  const color =
    pct == null
      ? 'hsl(38 92% 55%)'
      : pct >= 80
        ? DONE_COLOR
        : 'hsl(217 91% 60%)'

  return (
    <div className="flex min-w-[88px] flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span
          className={cn(
            'font-medium tabular-nums',
            done && 'text-emerald-600 dark:text-emerald-400'
          )}
        >
          {label}
        </span>
        <span className="truncate text-right tabular-nums text-muted-foreground">
          {d.readableReadRows} / {denom}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        {done ? (
          <div
            className="absolute inset-y-0 left-0 w-full rounded-full"
            style={{ background: DONE_COLOR }}
          />
        ) : pct != null ? (
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all"
            style={{ width: `${Math.max(pct, 2)}%`, background: color }}
          />
        ) : indeterminate ? (
          // No known total — a segment slides across to signal live scanning.
          <div
            className="absolute inset-y-0 w-1/3 animate-rq-indeterminate rounded-full"
            style={{ background: color }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** A small CPU-utilisation bar + percentage. */
export function CpuMeter({ pct }: { pct: number }) {
  const rounded = Math.round(pct)
  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="h-1 w-9 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(pct, 3)}%`,
            background: pct > 70 ? 'hsl(0 84% 60%)' : 'hsl(217 91% 60%)',
          }}
        />
      </div>
      <span className="tabular-nums">{rounded}%</span>
    </div>
  )
}
