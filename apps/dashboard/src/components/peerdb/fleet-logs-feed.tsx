import type { LogGroupBy } from '@/lib/peerdb/log-groups'
import type { ListMirrorLogsResponse, MirrorLog } from '@/lib/peerdb/types'

import { LogLine, LogPatternList, segmentClass } from './log-pattern-list'
import { parseTs } from './peerdb-utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupLogs, toLogFeedEntry } from '@/lib/peerdb/log-groups'
import {
  countMirrorLogLevels,
  extractMirrorLogs,
  mirrorLogsRequestBody,
} from '@/lib/peerdb/mirror-logs'
import { usePeerDB } from '@/lib/swr'

type Level = 'all' | 'error' | 'warn' | 'info'
const LEVELS: Level[] = ['all', 'error', 'warn', 'info']

type View = 'patterns' | 'raw'
const VIEWS: View[] = ['patterns', 'raw']

const GROUP_BYS: { id: LogGroupBy; label: string }[] = [
  { id: 'pattern', label: 'Pattern' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'table', label: 'Table' },
]

/** Bound the fan-out: only the first N mirrors contribute to the feed. */
const MAX_SOURCES = 25
const PAGE = 12

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

/**
 * Unified logs / alerts feed across all mirrors on the index page. Aggregates
 * `POST /v1/mirrors/logs` per mirror, merges newest-first, and filters by level
 * (error / warn / info). The default Patterns view groups repeats (by message
 * pattern, mirror, or table) with info groups collapsed behind errors and
 * warnings; Raw shows every line. Rows deep-link to the mirror detail page.
 */
export function FleetLogsFeed({ mirrors }: { mirrors: string[] }) {
  const [view, setView] = useState<View>('patterns')
  const [groupBy, setGroupBy] = useState<LogGroupBy>('pattern')
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

  const all = useMemo(() => {
    const out = []
    for (const m of sources) {
      for (const l of byMirror[m] ?? []) {
        out.push(toLogFeedEntry(l, m, parseTs(l.errorTimestamp)))
      }
    }
    return out.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  }, [sources, byMirror])

  const counts = useMemo(() => countMirrorLogLevels(all), [all])

  const filtered = useMemo(
    () => (level === 'all' ? all : all.filter((l) => l.level === level)),
    [all, level]
  )
  const groups = useMemo(
    () => groupLogs(filtered, groupBy),
    [filtered, groupBy]
  )

  const rawRows = showAll ? filtered : filtered.slice(0, PAGE)

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
          {view === 'patterns' && (
            <div
              role="group"
              aria-label="Group by"
              className="flex items-center gap-0.5 rounded bg-muted p-0.5"
            >
              {GROUP_BYS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={groupBy === g.id}
                  onClick={() => setGroupBy(g.id)}
                  className={segmentClass(groupBy === g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
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
        <LogPatternList key={groupBy} groups={groups} pageSize={PAGE} />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {rawRows.map((l, i) => (
              <li key={`${l.mirror}-${l.id ?? i}`}>
                <LogLine entry={l} />
              </li>
            ))}
          </ul>
          {filtered.length > PAGE && (
            <div className="border-t border-border px-3 py-1.5 text-center">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showAll ? 'Show fewer' : `Show all ${filtered.length} entries`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
