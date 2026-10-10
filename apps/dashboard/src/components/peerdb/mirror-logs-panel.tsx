import type { ListMirrorLogsResponse } from '@/lib/peerdb/types'

import { LogLine, LogPatternList, segmentClass } from './log-pattern-list'
import { parseTs } from './peerdb-utils'
import { useMemo, useState } from 'react'
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

const PAGE = 6

/** Mirror logs panel with Patterns/Raw views and level tabs — POST /v1/mirrors/logs. */
export function MirrorLogsPanel({ flowJobName }: { flowJobName: string }) {
  const [view, setView] = useState<View>('patterns')
  const [level, setLevel] = useState<Level>('all')
  const [showAll, setShowAll] = useState(false)

  // Always fetch the unfiltered set for the per-tab counts. When a specific
  // level is selected, also request it server-side (PeerDB filters before the
  // numPerPage cap), so the level tabs aren't limited to whatever happened to
  // be in the first page of all logs. The `all` selection reuses this request.
  const countsReq = usePeerDB<ListMirrorLogsResponse>('/mirrors/logs', {
    body: mirrorLogsRequestBody(flowJobName, 'all', { numPerPage: 100 }),
    refreshInterval: 60_000,
  })
  const listReq = usePeerDB<ListMirrorLogsResponse>('/mirrors/logs', {
    body: mirrorLogsRequestBody(flowJobName, level, { numPerPage: 100 }),
    refreshInterval: 60_000,
  })

  const counts = countMirrorLogLevels(extractMirrorLogs(countsReq.data))

  const filtered = useMemo(() => {
    const sorted = extractMirrorLogs(listReq.data)
      .map((l) => toLogFeedEntry(l, flowJobName, parseTs(l.errorTimestamp)))
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
    // Client-side filter as a safety net for upstreams that ignore `level`.
    return level === 'all' ? sorted : sorted.filter((l) => l.level === level)
  }, [listReq.data, level, flowJobName])
  const groups = useMemo(() => groupLogs(filtered, 'pattern'), [filtered])
  const rows = showAll ? filtered : filtered.slice(0, PAGE)

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mirror logs
          </span>
          <span className="text-[10.5px] text-muted-foreground">·</span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            POST /v1/mirrors/logs
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
      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11.5px] text-muted-foreground">
          No logs at this level
        </div>
      ) : view === 'patterns' ? (
        <LogPatternList groups={groups} pageSize={PAGE} showMirrors={false} />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {rows.map((l, i) => (
              <li key={l.id ?? i}>
                <LogLine entry={l} showMirror={false} />
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
                {showAll
                  ? 'Show fewer'
                  : `Show all ${filtered.length} log entries`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
