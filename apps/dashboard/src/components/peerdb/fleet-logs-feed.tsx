import type { ListMirrorLogsResponse, MirrorLog } from '@/lib/peerdb/types'

import {
  LOG_LEVEL_META,
  normalizePdbLogLevel,
  parseTs,
  pdbFmtClock,
  pdbFmtRelative,
} from './peerdb-utils'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppLink } from '@/components/ui/app-link'
import { usePeerDB } from '@/lib/swr'

type Level = 'all' | 'error' | 'warn' | 'info'
const LEVELS: Level[] = ['all', 'error', 'warn', 'info']

/** Bound the fan-out: only the first N mirrors contribute to the feed. */
const MAX_SOURCES = 25
const PAGE = 12

interface FeedEntry extends MirrorLog {
  mirror: string
}

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
    body: { flowJobName: mirror, page: 0, numPerPage: 50 },
    refreshInterval: 60_000,
  })
  const errors = data?.errors
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
 * (error / warn / info). Each row deep-links to its mirror detail page.
 */
export function FleetLogsFeed({ mirrors }: { mirrors: string[] }) {
  const [level, setLevel] = useState<Level>('all')
  const [showAll, setShowAll] = useState(false)
  const [byMirror, setByMirror] = useState<Record<string, MirrorLog[]>>({})

  const sources = mirrors.slice(0, MAX_SOURCES)

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
      for (const l of byMirror[m] ?? []) out.push({ ...l, mirror: m })
    }
    return out.sort(
      (a, b) =>
        (parseTs(b.errorTimestamp) ?? 0) - (parseTs(a.errorTimestamp) ?? 0)
    )
  }, [sources, byMirror])

  const counts = useMemo(() => {
    const c: Record<Level, number> = { all: 0, error: 0, warn: 0, info: 0 }
    for (const l of all) {
      c.all++
      c[normalizePdbLogLevel(l.errorType)]++
    }
    return c
  }, [all])

  const filtered =
    level === 'all'
      ? all
      : all.filter((l) => normalizePdbLogLevel(l.errorType) === level)
  const rows = showAll ? filtered : filtered.slice(0, PAGE)

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
        <div className="px-3 py-8 text-center text-[11.5px] text-muted-foreground">
          No log entries at this level
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((l, i) => {
            const lvl = normalizePdbLogLevel(l.errorType)
            const meta = LOG_LEVEL_META[lvl]
            return (
              <li
                key={`${l.mirror}-${l.id ?? i}`}
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
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] tabular-nums text-muted-foreground/80">
                    <AppLink
                      href={`/peerdb/mirror?name=${encodeURIComponent(l.mirror)}`}
                      className="font-mono font-medium text-primary hover:underline"
                    >
                      {l.mirror}
                    </AppLink>
                    <span>·</span>
                    <span>{pdbFmtRelative(l.errorTimestamp)}</span>
                    <span>·</span>
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
    </div>
  )
}
