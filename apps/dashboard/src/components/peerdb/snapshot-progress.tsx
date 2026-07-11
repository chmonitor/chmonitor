import type {
  CloneTableSummary,
  FlowStatus,
  InitialLoadSummaryResponse,
} from '@/lib/peerdb/types'

import { cloneProgress } from './peerdb-derive'
import {
  pdbFmtDuration,
  pdbFmtNum,
  toDesignStatus,
  toNumber,
} from './peerdb-utils'
import { usePeerDB } from '@/lib/swr'

/** Fetch/consolidate phase pill. */
function PhaseBadge({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium"
      style={
        done
          ? {
              background: 'rgba(16,185,129,0.12)',
              color: '#10b981',
              border: '1px solid rgba(16,185,129,0.35)',
            }
          : {
              background: 'rgba(148,163,184,0.12)',
              color: '#94a3b8',
              border: '1px solid rgba(148,163,184,0.30)',
            }
      }
    >
      <span
        className="size-1 rounded-full"
        style={{ background: done ? '#10b981' : '#94a3b8' }}
      />
      {label}
    </span>
  )
}

function SnapshotRow({ summary }: { summary: CloneTableSummary }) {
  const { completed, total, pct, done } = cloneProgress(summary)
  const avgMs = toNumber(summary.avgTimePerPartitionMs)
  const barColor = done ? '#10b981' : '#3b82f6'
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="truncate font-mono text-[12px] font-semibold">
          {summary.tableName ?? summary.sourceTable ?? '—'}
        </span>
        <div className="flex items-center gap-1.5">
          <PhaseBadge label="fetch" done={Boolean(summary.fetchCompleted)} />
          <PhaseBadge
            label="consolidate"
            done={Boolean(summary.consolidateCompleted)}
          />
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[10.5px] tabular-nums text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">
            {completed}/{total || '—'}
          </span>{' '}
          partitions ({pct.toFixed(0)}%)
        </span>
        <span>
          <span className="font-semibold text-foreground">
            {pdbFmtNum(toNumber(summary.numRowsSynced))}
          </span>{' '}
          rows synced
        </span>
        {avgMs > 0 && (
          <span>
            avg{' '}
            <span className="font-semibold text-foreground">
              {pdbFmtDuration(avgMs / 1000)}
            </span>
            /partition
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Snapshot / initial-load progress — per-table clone summaries from
 * `GET /v1/mirrors/cdc/initial_load/{flow}` (proto `InitialLoadSummary`).
 *
 * Snapshotting mirrors show almost nothing else today; this fills the gap with
 * per-table partition progress, rows synced, avg time/partition, and
 * fetch/consolidate phase badges. Rendered when the mirror is snapshotting OR
 * whenever the initial-load endpoint still returns rows (a just-finished
 * backfill remains visible until PeerDB clears it).
 */
export function SnapshotProgress({
  flowJobName,
  status,
}: {
  flowJobName: string
  status?: FlowStatus
}) {
  const snapshotting = toDesignStatus(status) === 'snapshotting'
  const { data } = usePeerDB<InitialLoadSummaryResponse>(
    flowJobName
      ? `/mirrors/cdc/initial_load/${encodeURIComponent(flowJobName)}`
      : null,
    { refreshInterval: snapshotting ? 15_000 : 60_000 }
  )

  const summaries = data?.tableSummaries ?? []
  if (summaries.length === 0) return null

  const totalTables = summaries.length
  const doneTables = summaries.filter((s) => cloneProgress(s).done).length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Snapshot progress</h2>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          GET /v1/mirrors/cdc/initial_load/&lt;flow&gt;
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Initial load
          </span>
          <span className="text-[11px] tabular-nums">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {doneTables}
            </span>
            <span className="text-muted-foreground">
              {' '}
              / {totalTables} tables cloned
            </span>
          </span>
        </div>
        {summaries.map((s, i) => (
          <SnapshotRow key={s.tableName ?? s.sourceTable ?? i} summary={s} />
        ))}
      </div>
    </section>
  )
}
