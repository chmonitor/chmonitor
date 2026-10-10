import { ChevronRight } from 'lucide-react'

import type { ReactNode } from 'react'
import type { LogPatternGroup } from '@/lib/peerdb/log-fingerprint'
import type { LogFeedEntry } from '@/lib/peerdb/log-groups'
import type { MirrorLogLevel } from '@/lib/peerdb/mirror-logs'

import { LOG_LEVEL_META, pdbFmtClock, pdbFmtRelative } from './peerdb-utils'
import { useMemo, useState } from 'react'
import { AppLink } from '@/components/ui/app-link'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  bucketCounts,
  splitInfoGroups,
  timeRange,
} from '@/lib/peerdb/log-groups'
import { cn } from '@/lib/utils'

/** Mirror chips shown on a pattern row before collapsing into "+N". */
const MAX_CHIPS = 3
/** Raw lines revealed when a pattern row is expanded. */
const EXPANDED_LINES = 20
const SPARK_BUCKETS = 16

export const segmentClass = (active: boolean) =>
  cn(
    'inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] font-medium',
    active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
  )

function LevelBadge({ level }: { level: MirrorLogLevel }) {
  const meta = LOG_LEVEL_META[level]
  return (
    <span
      className="mt-0.5 inline-flex h-4 shrink-0 items-center justify-center rounded px-1.5 font-mono text-[9.5px] font-bold"
      style={{
        background: `${meta.dot}14`,
        color: meta.dot,
        border: `1px solid ${meta.dot}40`,
      }}
    >
      {meta.label}
    </span>
  )
}

function MirrorLink({ mirror }: { mirror: string }) {
  return (
    <AppLink
      href={`/peerdb/mirror?name=${encodeURIComponent(mirror)}`}
      className="font-mono font-medium text-primary hover:underline"
    >
      {mirror}
    </AppLink>
  )
}

function LogMessage({
  level,
  children,
  title,
}: {
  level: MirrorLogLevel
  children: ReactNode
  title?: string
}) {
  return (
    <div
      className="break-words font-mono text-[11.5px] leading-snug"
      style={
        level === 'error' ? { color: LOG_LEVEL_META.error.dot } : undefined
      }
      title={title}
    >
      {children}
    </div>
  )
}

/** One raw log line. `showMirror` links the mirror; otherwise shows the row id. */
export function LogLine({
  entry,
  showMirror = true,
}: {
  entry: LogFeedEntry
  showMirror?: boolean
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <LevelBadge level={entry.level} />
      <div className="min-w-0 flex-1">
        <LogMessage level={entry.level}>{entry.errorMessage}</LogMessage>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] tabular-nums text-muted-foreground/80">
          {showMirror ? (
            <MirrorLink mirror={entry.mirror} />
          ) : (
            entry.id != null && <span className="font-mono">#{entry.id}</span>
          )}
          {(showMirror || entry.id != null) && <span>·</span>}
          <span>{pdbFmtRelative(entry.errorTimestamp)}</span>
          <span>·</span>
          <span className="font-mono">{pdbFmtClock(entry.errorTimestamp)}</span>
        </div>
      </div>
    </div>
  )
}

/** Tiny count-over-time bar chart (inline SVG, no chart dependency). */
function Sparkline({
  values,
  level,
}: {
  values: number[]
  level: MirrorLogLevel
}) {
  const max = Math.max(1, ...values)
  const w = 3
  const gap = 1
  const h = 14
  return (
    <svg
      role="img"
      aria-label="Count over the fetched time range"
      width={values.length * (w + gap) - gap}
      height={h}
      className="mt-0.5 shrink-0"
    >
      {values.map((v, i) => {
        const bar = v === 0 ? 1 : Math.max(2, (v / max) * h)
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - bar}
            width={w}
            height={bar}
            rx={0.5}
            fill={LOG_LEVEL_META[level].dot}
            opacity={v === 0 ? 0.2 : 0.85}
          />
        )
      })}
    </svg>
  )
}

/** One group: level, count, sparkline, last seen, mirrors, newest sample. */
function PatternRow({
  group,
  range,
  showMirrors,
}: {
  group: LogPatternGroup<LogFeedEntry>
  range: { from: number; to: number } | null
  showMirrors: boolean
}) {
  const [open, setOpen] = useState(false)
  const chips = group.mirrors.slice(0, MAX_CHIPS)
  const hidden = group.mirrors.length - chips.length
  const shown = group.entries.slice(0, EXPANDED_LINES)
  const spark = useMemo(
    () =>
      range
        ? bucketCounts(group.entries, range.from, range.to, SPARK_BUCKETS)
        : null,
    [group.entries, range]
  )
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-start gap-2.5 px-3 py-2">
        <CollapsibleTrigger
          aria-label={open ? 'Hide raw lines' : 'Show raw lines'}
          className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            strokeWidth={1.5}
          />
        </CollapsibleTrigger>
        <LevelBadge level={group.level} />
        <span className="mt-0.5 inline-flex h-4 shrink-0 items-center rounded bg-muted px-1.5 font-mono text-[10px] font-semibold tabular-nums">
          ×{group.count}
        </span>
        <div className="min-w-0 flex-1">
          <LogMessage level={group.level} title={group.fingerprint}>
            {group.sample.errorMessage}
          </LogMessage>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground/80">
            <span>last {pdbFmtRelative(group.sample.errorTimestamp)}</span>
            {showMirrors && (
              <>
                <span>·</span>
                {chips.map((m) => (
                  <span key={m} className="rounded border border-border px-1">
                    <MirrorLink mirror={m} />
                  </span>
                ))}
                {hidden > 0 && (
                  <span
                    className="rounded border border-border px-1"
                    title={group.mirrors.slice(MAX_CHIPS).join(', ')}
                  >
                    +{hidden} mirror{hidden === 1 ? '' : 's'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {spark && <Sparkline values={spark} level={group.level} />}
      </div>
      <CollapsibleContent>
        <div className="ml-6 divide-y divide-border border-l border-border bg-muted/20">
          {shown.map((l, i) => (
            <LogLine
              key={`${l.mirror}-${l.id ?? i}`}
              entry={l}
              showMirror={showMirrors}
            />
          ))}
          {group.count > shown.length && (
            <div className="px-3 py-1.5 text-[10.5px] text-muted-foreground">
              {group.count - shown.length} more lines. Switch to Raw to see them
              all.
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Grouped log list shared by the fleet feed and the per-mirror panel. Info
 * groups collapse behind a "show N info patterns" control whenever errors or
 * warnings exist. Sparklines share one time range so rows are comparable.
 */
export function LogPatternList({
  groups,
  pageSize,
  showMirrors = true,
}: {
  groups: LogPatternGroup<LogFeedEntry>[]
  pageSize: number
  showMirrors?: boolean
}) {
  const [showInfo, setShowInfo] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const range = useMemo(
    () => timeRange(groups.flatMap((g) => g.entries)),
    [groups]
  )
  const { visible, collapsed } = splitInfoGroups(groups)
  const list = showInfo ? groups : visible
  const rows = showAll ? list : list.slice(0, pageSize)

  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((g) => (
          <li key={`${g.level}-${g.fingerprint}`}>
            <PatternRow group={g} range={range} showMirrors={showMirrors} />
          </li>
        ))}
      </ul>
      {collapsed.length > 0 && (
        <div className="border-t border-border px-3 py-1.5 text-center">
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showInfo
              ? 'Hide info patterns'
              : `Show ${collapsed.length} info pattern${collapsed.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
      {list.length > pageSize && (
        <div className="border-t border-border px-3 py-1.5 text-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showAll ? 'Show fewer' : `Show all ${list.length} groups`}
          </button>
        </div>
      )}
    </>
  )
}
