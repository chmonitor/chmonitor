import { useQuery } from '@tanstack/react-query'

import type { ApiResponse } from '@/lib/api/types'
import type { LogPatternGroup } from '@/lib/peerdb/log-fingerprint'
import type { LogFeedEntry, LogGroupBy } from '@/lib/peerdb/log-groups'
import type {
  FleetLogPatterns,
  LogWindow,
} from '@/lib/peerdb/log-patterns-aggregate'

import { LogLine, LogPatternList, segmentClass } from './log-pattern-list'
import { mirrorPrefixResolver } from './log-prefix'
import { useLogMutes } from './use-log-mutes'
import { useMemo, useState } from 'react'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { groupLogs } from '@/lib/peerdb/log-groups'
import { DEFAULT_LOG_WINDOW } from '@/lib/peerdb/log-patterns-aggregate'
import { countMirrorLogLevels } from '@/lib/peerdb/mirror-logs'
import { PEERDB_CONNECTION_PARAM } from '@/lib/peerdb/peerdb-auth'
import { apiFetch } from '@/lib/swr/api-fetch'
import { visibilityAwareInterval } from '@/lib/swr/config'

const EMPTY: LogFeedEntry[] = []

type Level = 'all' | 'error' | 'warn' | 'info'
const LEVELS: Level[] = ['all', 'error', 'warn', 'info']

type View = 'patterns' | 'raw'
const VIEWS: View[] = ['patterns', 'raw']

const GROUP_BYS: { id: LogGroupBy; label: string }[] = [
  { id: 'pattern', label: 'Pattern' },
  { id: 'mirror', label: 'Mirror' },
  { id: 'prefix', label: 'Prefix' },
  { id: 'table', label: 'Table' },
]

const WINDOWS: LogWindow[] = ['1h', '24h', '7d']

type Sort = 'level' | 'last' | 'count'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'level', label: 'Level' },
  { id: 'last', label: 'Last seen' },
  { id: 'count', label: 'Count' },
]

const PAGE = 12
const PATTERNS_URL = '/api/v1/peerdb/log-patterns'

type FleetLogPatternsPayload = FleetLogPatterns & { generatedAt: string }

async function fetchPatterns(url: string): Promise<FleetLogPatternsPayload> {
  const response = await apiFetch(url)
  if (!response.ok) {
    throw new Error(`PeerDB log patterns request failed (${response.status})`)
  }
  const json = (await response.json()) as ApiResponse<FleetLogPatternsPayload>
  if (!json?.data || !Array.isArray(json.data.entries)) {
    throw new Error('Malformed PeerDB log patterns response')
  }
  return json.data
}

/** Server-side fleet read (`GET /api/v1/peerdb/log-patterns`) for one window. */
function useFleetLogPatterns(window: LogWindow) {
  const searchParams = useUrlSearchParams()
  const connection = searchParams.get(PEERDB_CONNECTION_PARAM) ?? ''
  const qs = new URLSearchParams({ window })
  if (connection) qs.set(PEERDB_CONNECTION_PARAM, connection)
  return useQuery({
    queryKey: [PATTERNS_URL, window, connection],
    queryFn: () => fetchPatterns(`${PATTERNS_URL}?${qs.toString()}`),
    refetchInterval: visibilityAwareInterval(60_000),
    retry: false,
  })
}

const SEVERITY = { error: 2, warn: 1, info: 0 } as const

function sortGroups<G extends LogPatternGroup<LogFeedEntry>>(
  groups: G[],
  sort: Sort
): G[] {
  if (sort === 'level') return groups // grouping already sorts by severity
  return [...groups].sort((a, b) =>
    sort === 'count'
      ? b.count - a.count || (b.lastSeen ?? 0) - (a.lastSeen ?? 0)
      : (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
        SEVERITY[b.level] - SEVERITY[a.level]
  )
}

/**
 * Unified logs / alerts feed across all mirrors on the index page. The server
 * reads every mirror's `POST /v1/mirrors/logs` with bounded concurrency and
 * returns in-window lines (1h / 24h / 7d) plus coverage; this view filters by
 * level (error / warn / info). The default Patterns view groups repeats (by
 * message pattern, mirror, mirror prefix group, or table, sorted by level, last seen, or count)
 * with info groups collapsed behind errors and warnings; Raw shows every line.
 * Rows deep-link to the mirror detail page.
 */
export function FleetLogsFeed() {
  const [view, setView] = useState<View>('patterns')
  const [groupBy, setGroupBy] = useState<LogGroupBy>('pattern')
  const [level, setLevel] = useState<Level>('all')
  const [window, setWindow] = useState<LogWindow>(DEFAULT_LOG_WINDOW)
  const [sort, setSort] = useState<Sort>('level')
  const [showAll, setShowAll] = useState(false)

  const { data, error, isLoading } = useFleetLogPatterns(window)
  const all = data?.entries ?? EMPTY

  const counts = useMemo(() => countMirrorLogLevels(all), [all])

  const filtered = useMemo(
    () => (level === 'all' ? all : all.filter((l) => l.level === level)),
    [all, level]
  )
  const prefixOf = useMemo(
    () => mirrorPrefixResolver(all.map((l) => l.mirror)),
    [all]
  )
  const groups = useMemo(
    () => sortGroups(groupLogs(filtered, groupBy, prefixOf), sort),
    [filtered, groupBy, prefixOf, sort]
  )
  const { mutes, mute, unmute } = useLogMutes()

  const rawRows = showAll ? filtered : filtered.slice(0, PAGE)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Fleet logs & alerts
          </span>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            POST /v1/mirrors/logs
            {data &&
              ` · ${data.mirrorsRead}/${data.mirrorsTotal} mirror${data.mirrorsTotal === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div
            role="group"
            aria-label="Time window"
            className="flex items-center gap-0.5 rounded bg-muted p-0.5"
          >
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                aria-pressed={window === w}
                onClick={() => setWindow(w)}
                className={segmentClass(window === w)}
              >
                {w}
              </button>
            ))}
          </div>
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
          {view === 'patterns' && (
            <div
              role="group"
              aria-label="Sort by"
              className="flex items-center gap-0.5 rounded bg-muted p-0.5"
            >
              {SORTS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={sort === o.id}
                  onClick={() => setSort(o.id)}
                  className={segmentClass(sort === o.id)}
                >
                  {o.label}
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

      {data && (data.partial || data.mirrorsTruncated > 0) && (
        <div className="border-b border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
          {data.partial &&
            `Read logs from ${data.mirrorsRead} of ${data.mirrorsTotal} mirrors; the rest failed or timed out. `}
          {data.mirrorsTruncated > 0 &&
            `${data.mirrorsTruncated} mirror${data.mirrorsTruncated === 1 ? ' has' : 's have'} more lines in this window than one read returns; open a mirror to see all of them.`}
        </div>
      )}

      {isLoading ? (
        <div className="px-3 py-8 text-center text-[11.5px] text-muted-foreground">
          Reading mirror logs…
        </div>
      ) : error && !data ? (
        <div className="px-3 py-8 text-center text-[11.5px] text-muted-foreground">
          Could not read fleet logs: {error.message}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-3 py-8 text-center text-[11.5px] text-muted-foreground">
          No log entries at this level in the last {window}
        </div>
      ) : view === 'patterns' ? (
        <LogPatternList
          key={`${groupBy}-${sort}`}
          groups={groups}
          pageSize={PAGE}
          {...(groupBy === 'pattern'
            ? { mutes, onMute: mute, onUnmute: unmute }
            : {})}
        />
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
