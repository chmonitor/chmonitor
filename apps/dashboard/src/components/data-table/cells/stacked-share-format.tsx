'use client'

import type { Row, RowData } from '@tanstack/react-table'

import { cn } from '@/lib/utils'

export interface StackedShareOptions {
  keepKey?: string
  dropKey?: string
  keepLabel?: string
  dropLabel?: string
}

interface StackedShareFormatProps<TData extends RowData = RowData> {
  row: Row<TData>
  options?: StackedShareOptions
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function StackedShareFormat<TData extends RowData = RowData>({
  row,
  options,
}: StackedShareFormatProps<TData>): React.ReactNode {
  const original = row.original as Record<string, unknown>
  const keepKey = options?.keepKey ?? 'bytes_in_range'
  const dropKey = options?.dropKey ?? 'bytes_past_ttl'
  const keep = num(original[keepKey])
  const drop = num(original[dropKey])
  const total = keep + drop
  const ttlDays = num(original.ttl_days)
  const keepLabel =
    String(original[`readable_${keepKey}`] ?? '') || options?.keepLabel
  const dropLabel =
    String(original[`readable_${dropKey}`] ?? '') || options?.dropLabel
  const rowsDrop = String(original.readable_rows_past_ttl ?? '')
  const keepPct = total > 0 ? (keep / total) * 100 : 0
  const dropPct = total > 0 ? (drop / total) * 100 : 0

  if (ttlDays <= 0) {
    return <span className="text-muted-foreground text-xs">No table TTL</span>
  }

  if (total <= 0) {
    return <span className="text-muted-foreground text-xs">No parts</span>
  }

  const title = `${keepLabel || keep} in range · ${dropLabel || drop} past TTL${
    rowsDrop ? ` (${rowsDrop} rows)` : ''
  }`

  return (
    <div className="flex min-w-[12rem] flex-col gap-1" title={title}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-sm bg-muted"
        role="img"
        aria-label={title}
      >
        <div
          className="h-full bg-[var(--chart-green)]"
          style={{ width: `${keepPct}%` }}
        />
        <div
          className="h-full bg-[var(--chart-yellow)]"
          style={{ width: `${dropPct}%` }}
        />
      </div>
      <div className="text-muted-foreground flex gap-2 text-[11px] tabular-nums">
        <span className={cn(drop > 0 ? 'text-foreground' : undefined)}>
          {keepLabel} in range
        </span>
        {drop > 0 ? (
          <span className="text-[var(--chart-yellow)]">
            {dropLabel} past TTL
          </span>
        ) : (
          <span>all in range</span>
        )}
      </div>
    </div>
  )
}
