import {
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  HardDrive,
  MemoryStick,
  User as UserIcon,
} from 'lucide-react'

import type { DerivedQuery } from './types'

import { DoneBadge, ProgressCell } from './cells'
import { ExpandedRow } from './expanded-row'
import { useKillQuery } from './use-kill-query'
import { memo } from 'react'
import { formatDuration } from '@/components/query-tables/format-duration'
import { KindBadge } from '@/components/query-tables/kind-badge'
import { formatReadableSize } from '@/lib/format-readable'
import { cn } from '@/lib/utils'

interface QueryCardProps {
  d: DerivedQuery
  expanded: boolean
  onToggle: () => void
  /** Query has finished and its card is retained in a "Done" state. */
  done?: boolean
  /** Drop this retained Done card from the list. */
  onDismiss?: () => void
}

/**
 * One running query as a card — the mobile-first counterpart to QueryRow.
 * Leads with the SQL (a highlighted, tappable-to-expand hero block), then the
 * key live metrics; expanding reuses the same ExpandedRow detail panel.
 */
export const QueryCard = memo(function QueryCard({
  d,
  expanded,
  onToggle,
  done,
  onDismiss,
}: QueryCardProps) {
  const { isKilling, handleKill } = useKillQuery(d.id)
  const ExpandIcon = expanded ? ChevronDown : ChevronRight
  const dur = formatDuration(d.elapsed)

  return (
    <div
      data-testid="running-query-card"
      data-expanded={expanded || undefined}
      className={cn(
        'overflow-hidden rounded-lg border border-border/60 bg-card/40',
        done &&
          'border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-2.5 p-3 text-left"
      >
        {/* Header: kind badge + short id + expand affordance */}
        <div className="flex min-w-0 items-center gap-2">
          {done && <DoneBadge />}
          <KindBadge kind={d.kind} />
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            #{d.id ? d.id.slice(0, 8) : 'n/a'}
          </span>
          <ExpandIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </div>

        {/* SQL hero — the focus of the card */}
        <div className="min-w-0 rounded-md border border-border/50 bg-muted/60 p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
            <Code2 className="size-3 shrink-0" />
            Query
          </div>
          <pre className="m-0 line-clamp-4 whitespace-pre-wrap break-words font-mono text-[0.8rem] leading-relaxed text-foreground">
            {d.query}
          </pre>
        </div>

        {/* Key live metrics */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {d.user && (
            <span className="inline-flex items-center gap-1">
              <UserIcon className="size-3" />
              {d.user}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {dur.value} {dur.unit}
          </span>
          <span className="inline-flex items-center gap-1">
            <MemoryStick className="size-3" />
            {d.readableMemory}
          </span>
          <span className="inline-flex items-center gap-1">
            <HardDrive className="size-3" />
            {formatReadableSize(d.readBytes)}
          </span>
        </div>

        <ProgressCell d={d} done={done} />
      </button>

      {expanded && (
        <ExpandedRow
          d={d}
          onKill={handleKill}
          isKilling={isKilling}
          done={done}
          onDismiss={onDismiss}
        />
      )}
    </div>
  )
})
