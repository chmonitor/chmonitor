import { ChevronRight } from 'lucide-react'

import type { ReactNode } from 'react'
import type { LogPatternGroup } from '@/lib/peerdb/log-fingerprint'
import type { MirrorLogLevel } from '@/lib/peerdb/mirror-logs'
import type { ListMirrorLogsResponse, MirrorLog } from '@/lib/peerdb/types'

import {
  LOG_LEVEL_META,
  parseTs,
  pdbFmtClock,
  pdbFmtRelative,
} from './peerdb-utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppLink } from '@/components/ui/app-link'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { groupLogsByPattern } from '@/lib/peerdb/log-fingerprint'
import {
  countMirrorLogLevels,
  extractMirrorLogs,
  mirrorLogsRequestBody,
  normalizeLogLevel,
} from '@/lib/peerdb/mirror-logs'
import { usePeerDB } from '@/lib/swr'
import { cn } from '@/lib/utils'

type Level = 'all' | 'error' | 'warn' | 'info'
const LEVELS: Level[] = ['all', 'error', 'warn', 'info']

type View = 'patterns' | 'raw'
const VIEWS: View[] = ['patterns', 'raw']

/** Bound the fan-out: only the first N mirrors contribute to the feed. */
const MAX_SOURCES = 25
const PAGE = 12
/** Mirror chips shown on a pattern row before collapsing into "+N". */
const MAX_CHIPS = 3
/** Raw lines revealed when a pattern row is expanded. */
const EXPANDED_LINES = 20

interface FeedEntry extends MirrorLog {
  mirror: string
  message: string
  level: MirrorLogLevel
  ts: number | null
}

const segmentClass = (active: boolean) =>
  cn(
    'inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] font-medium',
    active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
  )

/**
 * Hidden per-mirror log fetcher (POST /v1/mirrors/logs). Reports its entries up
 * so the feed can merge across the fleet without a bespoke aggregate endpoint.
 */
function LogSource({
  mirror,
  onLogs,
}: {
  mirror: string
  onLogs: (mirror: string, logs: MirrorLog[]) => void
}) {
  const { data } = usePeerDB<ListMirrorLogsResponse>('/mirrors/logs', {
    body: mirrorLogsRequestBody(mirror, 'all', { numPerPage: 50 }),
    refreshInterval: 60_000,
  })
  const errors = data ? extractMirrorLogs(data) : undefined
  const key = errors?.length ?? -1
  // Re-report whenever the returned set changes size (cheap change signal).
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors tracked via key
  useEffect(() => {
    if (errors) onLogs(mirror, errors)
  }, [mirror, key, onLogs])
  return null
}

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

function LogLine({ entry }: { entry: FeedEntry }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <LevelBadge level={entry.level} />
      <div className="min-w-0 flex-1">
        <LogMessage level={entry.level}>{entry.errorMessage}</LogMessage>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] tabular-nums text-muted-foreground/80">
          <MirrorLink mirror={entry.mirror} />
          <span>·</span>
          <span>{pdbFmtRelative(entry.errorTimestamp)}</span>
          <span>·</span>
          <span className="font-mono">{pdbFmtClock(entry.errorTimestamp)}</span>
        </div>
      </div>
    </div>
  )
}

/** One message pattern: level, count, last seen, mirrors, newest sample. */
function PatternRow({ group }: { group: LogPatternGroup<FeedEntry> }) {
  const [open, setOpen] = useState(false)
  const chips = group.mirrors.slice(0, MAX_CHIPS)
  const hidden = group.mirrors.length - chips.length
  const shown = group.entries.slice(0, EXPANDED_LINES)
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
          </div>
        </div>
      </div>
      <CollapsibleContent>
        <div className="ml-6 divide-y divide-border border-l border-border bg-muted/20">
          {shown.map((l, i) => (
            <LogLine key={`${l.mirror}-${l.id ?? i}`} entry={l} />
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
 * Unified logs / alerts feed across all mirrors on the index page. Aggregates
 * `POST /v1/mirrors/logs` per mirror, merges newest-first, and filters by level
 * (error / warn / info). The default Patterns view groups repeats by message
 * fingerprint; Raw shows every line. Rows deep-link to the mirror detail page.
 */
export function FleetLogsFeed({ mirrors }: { mirrors: string[] }) {
  const [view, setView] = useState<View>('patterns')
  const [level, setLevel] = useState<Level>('all')
  const [showAll, setShowAll] = useState(false)
  const [byMirror, setByMirror] = useState<Record<string, MirrorLog[]>>({})

  const sources = mirrors.slice(0, MAX_SOURCES)
  const droppedMirrors = mirrors.length - sources.length

  const onLogs = useCallback((mirror: string, logs: MirrorLog[]) => {
    setByMirror((prev) => {
      const cur = prev[mirror]
      if (cur && cur.length === logs.length) return prev
      return { ...prev, [mirror]: logs }
    })
  }, [])

  const all: FeedEntry[] = useMemo(() => {
    const out: FeedEntry[] = []
    for (const m of sources) {
      for (const l of byMirror[m] ?? []) {
        out.push({
          ...l,
          mirror: m,
          message: l.errorMessage ?? '',
          level: normalizeLogLevel(l.errorType),
          ts: parseTs(l.errorTimestamp),
        })
      }
    }
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  }, [sources, byMirror])

  const counts = useMemo(() => countMirrorLogLevels(all), [all])

  const filtered = useMemo(
    () => (level === 'all' ? all : all.filter((l) => l.level === level)),
    [all, level]
  )
  const groups = useMemo(() => groupLogsByPattern(filtered), [filtered])

  const total = view === 'patterns' ? groups.length : filtered.length
  const rawRows = showAll ? filtered : filtered.slice(0, PAGE)
  const patternRows = showAll ? groups : groups.slice(0, PAGE)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {sources.map((m) => (
        <LogSource key={m} mirror={m} onLogs={onLogs} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fleet logs & alerts
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            POST /v1/mirrors/logs · {sources.length} mirror
            {sources.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded bg-muted p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={segmentClass(view === v)}
              >
                {v === 'patterns' ? 'Patterns' : 'Raw'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded bg-muted p-0.5">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                aria-pressed={level === lvl}
                onClick={() => setLevel(lvl)}
                className={segmentClass(level === lvl)}
              >
                {lvl === 'all' ? 'All' : lvl.toUpperCase()}
                <span className="text-[9.5px] tabular-nums opacity-70">
                  {counts[lvl]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {droppedMirrors > 0 && (
        <div className="border-b border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
          Showing logs from {sources.length} of {mirrors.length} mirrors. The
          other {droppedMirrors} are not read here; open a mirror to see its
          logs.
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-3 py-8 text-center text-[11.5px] text-muted-foreground">
          No log entries at this level
        </div>
      ) : view === 'patterns' ? (
        <ul className="divide-y divide-border">
          {patternRows.map((g) => (
            <li key={`${g.level}-${g.fingerprint}`}>
              <PatternRow group={g} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {rawRows.map((l, i) => (
            <li key={`${l.mirror}-${l.id ?? i}`}>
              <LogLine entry={l} />
            </li>
          ))}
        </ul>
      )}

      {total > PAGE && (
        <div className="border-t border-border px-3 py-1.5 text-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showAll
              ? 'Show fewer'
              : `Show all ${total} ${view === 'patterns' ? 'patterns' : 'entries'}`}
          </button>
        </div>
      )}
    </div>
  )
}
