import { SearchIcon, XIcon } from 'lucide-react'

import type { QRepPartition } from '@/lib/peerdb/types'

import { jobPartitionAnalytics, partitionState } from './job-analytics'
import {
  durationMs,
  pdbFmtClock,
  pdbFmtDuration,
  pdbFmtNum,
  toNumber,
} from './peerdb-utils'
import { useMemo, useState } from 'react'

export { partitionState } from './job-analytics'

const PART_TONE: Record<string, string> = {
  done: '#10b981',
  running: '#3b82f6',
  queued: '#94a3b8',
  error: '#f43f5e',
}

/** Bucket partition rows-synced by completion hour for the sync-history chart. */
export function buildSyncHistory(
  partitions: QRepPartition[]
): { x: string; y: number }[] {
  const buckets = new Map<number, number>()
  for (const p of partitions) {
    const iso = p.endTime ?? p.pullEndTime ?? p.startTime
    if (!iso) continue
    const t = Date.parse(iso)
    if (Number.isNaN(t)) continue
    const hour = Math.floor(t / 3_600_000) * 3_600_000
    buckets.set(hour, (buckets.get(hour) ?? 0) + toNumber(p.rowsSynced))
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([h, y]) => ({
      x: new Date(h).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
      }),
      y,
    }))
}

const DEFAULT_PAGE_SIZE = 25

/** QRep partition sync-progress table with search, paging, and totals. */
export function QRepPartitions({
  partitions,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  partitions: QRepPartition[]
  pageSize?: number
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const stats = jobPartitionAnalytics(partitions)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? partitions.filter((p) =>
          (p.partitionId ?? '').toLowerCase().includes(q)
        )
      : partitions
    return [...list].sort((a, b) => {
      const at = Date.parse(a.startTime ?? '') || 0
      const bt = Date.parse(b.startTime ?? '') || 0
      return bt - at
    })
  }, [partitions, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const slice = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const from = filtered.length === 0 ? 0 : safePage * pageSize + 1
  const to = Math.min(filtered.length, (safePage + 1) * pageSize)

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Progress
          </span>
          <span className="text-[11px] tabular-nums">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {stats.done}
            </span>
            <span className="text-muted-foreground"> done</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {stats.running}
            </span>
            <span className="text-muted-foreground"> in flight</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="font-semibold text-muted-foreground">
              {stats.queued}
            </span>
            <span className="text-muted-foreground"> queued</span>
            {stats.error > 0 && (
              <>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  {stats.error}
                </span>
                <span className="text-muted-foreground"> error</span>
              </>
            )}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            · {pdbFmtNum(stats.rowsSynced)} / {pdbFmtNum(stats.rowsIn)} rows
            {stats.avgDurationSec != null && (
              <> · avg {pdbFmtDuration(stats.avgDurationSec)}</>
            )}
          </span>
        </div>
        <div className="flex h-7 w-[220px] items-center gap-1.5 rounded-md border border-border bg-card px-2">
          <SearchIcon className="size-3 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Search by partition"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setPage(0)
              }}
              className="text-muted-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="w-[44px] px-2.5 py-1.5">#</th>
              <th className="px-2.5 py-1.5">Partition UUID</th>
              <th className="w-[80px] px-2.5 py-1.5">Status</th>
              <th className="w-[88px] px-2.5 py-1.5 text-right">Duration</th>
              <th className="w-[102px] px-2.5 py-1.5 text-right">
                Start (UTC)
              </th>
              <th className="w-[102px] px-2.5 py-1.5 text-right">End (UTC)</th>
              <th className="w-[112px] px-2.5 py-1.5 text-right">
                Rows in partition
              </th>
              <th className="w-[100px] px-2.5 py-1.5 text-right">
                Rows synced
              </th>
              <th className="w-[130px] px-2.5 py-1.5">Progress</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((p, i) => {
              const st = partitionState(p)
              const tone = PART_TONE[st]
              const rowsIn = toNumber(p.rowsInPartition ?? p.numRows)
              const rowsSy = toNumber(p.rowsSynced)
              const pct = rowsIn
                ? Math.min(100, Math.max(0, (rowsSy / rowsIn) * 100))
                : 0
              const dur = durationMs(p.startTime, p.endTime ?? p.pullEndTime)
              const uuid = p.partitionId ?? ''
              return (
                <tr
                  key={uuid || i}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40"
                >
                  <td className="px-2.5 py-1.5 font-mono tabular-nums text-muted-foreground">
                    {from + i}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="font-mono text-[10.5px]" title={uuid}>
                      {uuid.length > 20
                        ? `${uuid.slice(0, 14)}…${uuid.slice(-4)}`
                        : uuid}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span
                      className="inline-flex items-center gap-1.5 text-[10.5px] font-medium"
                      style={{ color: tone }}
                    >
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: tone }}
                      />
                      {st}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                    {st === 'queued'
                      ? '—'
                      : pdbFmtDuration(dur ? dur / 1000 : 0)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {pdbFmtClock(p.startTime)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {pdbFmtClock(p.endTime ?? p.pullEndTime)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                    {pdbFmtNum(rowsIn)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                    {pdbFmtNum(rowsSy)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full transition-all"
                          style={{ width: `${pct}%`, background: tone }}
                        />
                      </div>
                      <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {from === 0 ? '0 of 0' : `${from}–${to} of ${filtered.length}`}
          {filtered.length !== partitions.length
            ? ` (filtered from ${partitions.length})`
            : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-md border border-border px-2 py-0.5 disabled:opacity-40"
          >
            Prev
          </button>
          <span className="tabular-nums">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            className="rounded-md border border-border px-2 py-0.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
