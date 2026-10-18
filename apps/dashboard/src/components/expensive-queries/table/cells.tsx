import { Flame } from 'lucide-react'

import { type DerivedQuery, SEVERITY_DURATION, type Severity } from './types'
import { formatDuration } from '@/components/query-tables/format-duration'
import { cn } from '@/lib/utils'

const RANK_BADGE: Record<Severity, string> = {
  critical:
    'bg-rose-100 text-rose-700 ring-1 ring-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:ring-rose-800',
  warning:
    'bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-800',
  normal: 'bg-muted text-muted-foreground',
}

export function RankBadge({
  rank,
  severity,
}: {
  rank: number
  severity: Severity
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
        RANK_BADGE[severity]
      )}
    >
      {rank <= 3 && severity !== 'normal' && (
        <Flame className="size-3 shrink-0" />
      )}
      #{rank}
    </span>
  )
}

export function MetricBar({
  value,
  unit,
  pct,
  color,
  valueClassName,
  align = 'left',
}: {
  value: string
  unit?: string
  pct: number
  color: string
  valueClassName?: string
  align?: 'left' | 'right'
}) {
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
  return (
    <div
      className={cn(
        'flex min-w-[72px] flex-col gap-1',
        align === 'right' && 'items-end'
      )}
    >
      <span
        className={cn(
          'text-[11px] tabular-nums',
          align === 'right' && 'text-right',
          valueClassName
        )}
      >
        {value}
        {unit && (
          <span className="ml-0.5 text-[10px] text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${Math.max(clamped, 2)}%`, background: color }}
        />
      </div>
    </div>
  )
}

const NEUTRAL_BAR = 'hsl(217 91% 60%)'

function severityColor(d: DerivedQuery): string {
  return d.severity === 'critical'
    ? 'hsl(0 84% 60%)'
    : d.severity === 'warning'
      ? 'hsl(38 92% 50%)'
      : NEUTRAL_BAR
}

export function TotalTimeCell({
  d,
  max,
  align = 'left',
}: {
  d: DerivedQuery
  max: number
  align?: 'left' | 'right'
}) {
  const t = formatDuration(d.queriesDuration)
  const pct = max > 0 ? (d.queriesDuration / max) * 100 : 0
  return (
    <MetricBar
      value={t.value}
      unit={t.unit}
      pct={pct}
      color={severityColor(d)}
      valueClassName={SEVERITY_DURATION[d.severity]}
      align={align}
    />
  )
}

export function CpuCell({
  d,
  max,
  align = 'right',
}: {
  d: DerivedQuery
  max: number
  align?: 'left' | 'right'
}) {
  const t = formatDuration(d.userTime)
  const pct = max > 0 ? (d.userTime / max) * 100 : 0
  return (
    <MetricBar
      value={t.value}
      unit={t.unit}
      pct={pct}
      color={NEUTRAL_BAR}
      align={align}
    />
  )
}

export function MemoryCell({
  d,
  max,
  align = 'right',
}: {
  d: DerivedQuery
  max: number
  align?: 'left' | 'right'
}) {
  const pct = max > 0 ? (d.memory / max) * 100 : 0
  return (
    <MetricBar
      value={d.readableMemory}
      pct={pct}
      color={NEUTRAL_BAR}
      align={align}
    />
  )
}
