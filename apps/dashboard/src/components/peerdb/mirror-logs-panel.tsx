import type { ListMirrorLogsResponse, MirrorLog } from '@/lib/peerdb/types'

import {
  LOG_LEVEL_META,
  parseTs,
  pdbFmtClock,
  pdbFmtRelative,
} from './peerdb-utils'
import { useState } from 'react'
import {
  countMirrorLogLevels,
  extractMirrorLogs,
  mirrorLogsRequestBody,
  normalizeLogLevel,
} from '@/lib/peerdb/mirror-logs'
import { usePeerDB } from '@/lib/swr'

type Level = 'all' | 'error' | 'warn' | 'info'
const LEVELS: Level[] = ['all', 'error', 'warn', 'info']

const sortByNewest = (list: MirrorLog[] = []) =>
  [...list].sort(
    (a, b) =>
      (parseTs(b.errorTimestamp) ?? 0) - (parseTs(a.errorTimestamp) ?? 0)
  )

/** Mirror logs panel with level tabs — POST /v1/mirrors/logs. */
export function MirrorLogsPanel({ flowJobName }: { flowJobName: string }) {
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

  const filtered = (() => {
    const sorted = sortByNewest(extractMirrorLogs(listReq.data))
    // Client-side filter as a safety net for upstreams that ignore `level`.
    return level === 'all'
      ? sorted
      : sorted.filter((l) => normalizeLogLevel(l.errorType) === level)
  })()
  const rows = showAll ? filtered : filtered.slice(0, 6)

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
        <div className="flex items-center gap-0.5 rounded bg-muted p-0.5">
          {LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevel(lvl)}
              className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[10.5px] font-medium ${
                level === lvl
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              {lvl === 'all' ? 'All' : lvl.toUpperCase()}
              <span className="text-[9.5px] tabular-nums opacity-70">
                {counts[lvl]}
              </span>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11.5px] text-muted-foreground">
          No logs at this level
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((l, i) => {
            const lvl = normalizeLogLevel(l.errorType)
            const meta = LOG_LEVEL_META[lvl]
            return (
              <li
                key={l.id ?? i}
                className="flex items-start gap-2.5 px-3 py-2"
              >
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
                <div className="min-w-0 flex-1">
                  <div
                    className="break-words font-mono text-[11.5px] leading-snug"
                    style={lvl === 'error' ? { color: meta.dot } : undefined}
                  >
                    {l.errorMessage}
                  </div>
                  <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/80">
                    {l.id != null && (
                      <>
                        <span className="font-mono">#{l.id}</span>
                        <span className="mx-1.5">·</span>
                      </>
                    )}
                    {pdbFmtRelative(l.errorTimestamp)}
                    <span className="mx-1.5">·</span>
                    <span className="font-mono">
                      {pdbFmtClock(l.errorTimestamp)}
                    </span>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {filtered.length > 6 && (
        <div className="border-t border-border px-3 py-1.5 text-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showAll ? 'Show fewer' : `Show all ${filtered.length} log entries`}
          </button>
        </div>
      )}
    </div>
  )
}
