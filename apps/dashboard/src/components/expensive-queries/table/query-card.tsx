import {
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  HardDrive,
  MemoryStick,
} from 'lucide-react'

import type { DerivedQuery } from './types'

import { RankBadge, TotalTimeCell } from './cells'
import { ExpandedRow } from './expanded-row'
import { memo } from 'react'
import { formatDuration } from '@/components/query-tables/format-duration'
import { formatCompactNumber } from '@/lib/format-readable'
import { cn } from '@/lib/utils'

interface QueryCardProps {
  d: DerivedQuery
  maxDuration: number
  expanded: boolean
  onToggle: () => void
}

/**
 * One fingerprint as a card — the mobile-first counterpart to QueryRow.
 * Leads with the rank + SQL, then the key cost metrics; expanding reuses the
 * same ExpandedRow detail panel.
 */
export const QueryCard = memo(function QueryCard({
  d,
  maxDuration,
  expanded,
  onToggle,
}: QueryCardProps) {
  const ExpandIcon = expanded ? ChevronDown : ChevronRight
  const cpu = formatDuration(d.userTime)

  return (
    <div
      data-testid="expensive-query-card"
      data-expanded={expanded || undefined}
      className={cn(
        'overflow-hidden rounded-lg border bg-card/40',
        d.severity === 'critical'
          ? 'border-rose-300/60 dark:border-rose-900/50'
          : d.severity === 'warning'
            ? 'border-amber-300/60 dark:border-amber-900/50'
            : 'border-border/60'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-2.5 p-3 text-left"
      >
        {/* Header: rank chip + total time + expand affordance */}
        <div className="flex min-w-0 items-center gap-2">
          <RankBadge rank={d.rank} severity={d.severity} />
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {formatCompactNumber(d.cnt)} runs
          </span>
          <ExpandIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </div>

        {/* SQL hero — the focus of the card */}
        <div className="min-w-0 rounded-md border border-border/50 bg-muted/60 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
            <Code2 className="size-3 shrink-0" />
            Query fingerprint
          </div>
          <pre className="m-0 line-clamp-4 whitespace-pre-wrap break-words font-mono text-[0.8rem] leading-relaxed text-foreground">
            {d.query}
          </pre>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {formatDuration(d.queriesDuration).value}{' '}
            {formatDuration(d.queriesDuration).unit}
          </span>
          <span className="inline-flex items-center gap-1">
            <Cpu className="size-3" />
            {cpu.value} {cpu.unit}
          </span>
          <span className="inline-flex items-center gap-1">
            <MemoryStick className="size-3" />
            {d.readableMemory}
          </span>
          <span className="inline-flex items-center gap-1">
            <HardDrive className="size-3" />
            {formatCompactNumber(d.readRows)} rows
          </span>
        </div>

        <TotalTimeCell d={d} max={maxDuration} />
      </button>

      {expanded && <ExpandedRow d={d} />}
    </div>
  )
})
