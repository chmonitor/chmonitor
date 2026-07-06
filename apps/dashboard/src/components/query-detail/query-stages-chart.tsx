import { Activity } from 'lucide-react'

import { useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useTableData } from '@/lib/query/use-table-data'
import { formatMicros, segmentWidthPct } from '@/lib/query/format-micros'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

interface ProcessorRow {
  name?: string
  elapsed_us?: number | string
  input_wait_us?: number | string
  output_wait_us?: number | string
  input_rows?: number | string
  output_rows?: number | string
  [key: string]: unknown
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function totalOf(r: ProcessorRow): number {
  return toNum(r.elapsed_us) + toNum(r.input_wait_us) + toNum(r.output_wait_us)
}

/**
 * "Query stages" — a duration-proportional horizontal bar chart of the
 * per-processor time breakdown for a query (active vs input-wait vs
 * output-wait), backed by `system.processors_profile_log` via the
 * `query-processors` config.
 *
 * This is a duration breakdown, not a wall-clock Gantt — `processors_profile_log`
 * carries aggregate elapsed per processor, not start/finish offsets. A true
 * time-axis Gantt would need OpenTelemetry spans, which require tracing enabled.
 *
 * The source table is optional (`log_processor_profiles`); when it is missing
 * or empty for this query the component renders nothing so the page stays clean.
 */
export function QueryStagesChart({ queryId }: { queryId: string }) {
  const hostId = useHostId()
  const { data, isLoading, error } = useTableData<ProcessorRow>(
    'query-processors',
    hostId,
    { query_id: queryId }
  )

  const rows = data ?? []
  const maxTotal = useMemo(
    () => rows.reduce((m, r) => Math.max(m, totalOf(r)), 0),
    [rows]
  )

  if (isLoading) return <StagesSkeleton />
  // Optional table — hide silently when unavailable or empty for this query.
  if (error || rows.length === 0 || maxTotal <= 0) return null

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Activity className="size-3.5" />
          Query stages
        </h2>
        <Legend />
      </div>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const active = toNum(r.elapsed_us)
          const inputWait = toNum(r.input_wait_us)
          const outputWait = toNum(r.output_wait_us)
          return (
            <li
              key={`${toStr(r.name)}-${i}`}
              className="grid grid-cols-[9rem_1fr_auto] items-center gap-3"
            >
              <span
                className="truncate font-mono text-[11px] text-muted-foreground"
                title={toStr(r.name)}
              >
                {toStr(r.name) || '—'}
              </span>
              <div className="flex h-4 overflow-hidden rounded bg-muted/40">
                <span
                  className="bg-sky-500"
                  style={{ width: `${segmentWidthPct(active, maxTotal)}%` }}
                />
                <span
                  className="bg-amber-500"
                  style={{ width: `${segmentWidthPct(inputWait, maxTotal)}%` }}
                />
                <span
                  className="bg-violet-500"
                  style={{ width: `${segmentWidthPct(outputWait, maxTotal)}%` }}
                />
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {formatMicros(active + inputWait + outputWait)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Legend() {
  const items: [string, string][] = [
    ['bg-sky-500', 'Active'],
    ['bg-amber-500', 'Input wait'],
    ['bg-violet-500', 'Output wait'],
  ]
  return (
    <div className="flex items-center gap-3">
      {items.map(([cls, label]) => (
        <span
          key={label}
          className="flex items-center gap-1 text-[10px] text-muted-foreground"
        >
          <span className={cn('size-2 rounded-sm', cls)} />
          {label}
        </span>
      ))}
    </div>
  )
}

function StagesSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Skeleton className="mb-3 h-3 w-24" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  )
}

function toStr(v: unknown): string {
  return v == null ? '' : String(v)
}
