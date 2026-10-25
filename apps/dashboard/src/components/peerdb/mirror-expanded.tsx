import { XIcon } from 'lucide-react'

import type { MirrorListItem } from '@/lib/peerdb/types'
import type { DerivedMetrics } from './use-mirror-metrics'

import { MirrorLogsPanel } from './mirror-logs-panel'
import { PhaseTimeline, phaseLabel } from './mirror-phase-timeline'
import { PdbAreaChart, PdbBarChart } from './pdb-charts'
import { PeerChip } from './peer-chip'
import { PeerInfoCard } from './peer-info-card'
import {
  DESIGN_STATUS_META,
  durationMs,
  pdbFmtAgo,
  pdbFmtLag,
  pdbFmtNum,
  toDesignStatus,
} from './peerdb-utils'
import {
  buildSyncHistory,
  partitionState,
  QRepPartitions,
} from './qrep-partitions'
import { AppLink } from '@/components/ui/app-link'
import { cn } from '@/lib/utils'

function ConfigField({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="-ml-px -mt-px min-w-0 border-l border-t border-border px-3 py-1.5">
      <dt className="text-[10px] max-sm:text-xs font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'truncate text-[12px] font-medium tabular-nums',
          mono && 'font-mono'
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

export function MirrorExpanded({
  mirror,
  metrics,
}: {
  mirror: MirrorListItem
  metrics: DerivedMetrics
}) {
  // Treat undefined `isCdc` as CDC consistently so labels and metrics agree.
  const isCdc = mirror.isCdc !== false
  const type = isCdc ? 'CDC' : 'QRep'
  const meta = DESIGN_STATUS_META[toDesignStatus(mirror.status)]
  const { trend, rowsPerSec, rowsSynced, lagSec, partitions, batches } = metrics
  const batchDurations = batches
    .map((b) => {
      const d = durationMs(b.startTime, b.endTime)
      return d == null ? 0 : d / 1000
    })
    .filter((n) => n >= 0)

  const partitionsDone = partitions.filter(
    (p) => partitionState(p) === 'done'
  ).length

  const createdAgo = pdbFmtAgo(mirror.createdAt)
  const fields: { l: string; v: string; mono?: boolean }[] = [
    { l: 'Mirror name', v: mirror.name, mono: true },
    { l: 'Type', v: type, mono: true },
    { l: 'Phase', v: phaseLabel(mirror.status) },
    { l: 'Source', v: mirror.sourceName ?? '—', mono: true },
    { l: 'Destination', v: mirror.destinationName ?? '—', mono: true },
    { l: 'Created', v: createdAgo === '—' ? '—' : `${createdAgo} ago` },
  ]
  if (mirror.workflowId)
    fields.push({ l: 'Workflow ID', v: mirror.workflowId, mono: true })

  return (
    <div className="space-y-4 border-t border-border bg-muted/40 px-3 py-4 sm:px-5">
      {metrics.errorMessage && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] leading-relaxed text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] max-sm:text-xs font-semibold uppercase tracking-wider opacity-80">
            <XIcon className="size-3" />
            Workflow exception
          </div>
          <div className="font-mono text-[11.5px] max-sm:text-xs">
            {metrics.errorMessage}
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-3.5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pipeline phase
            </div>
            <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[9.5px] max-sm:text-xs text-muted-foreground">
              {type}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] max-sm:text-xs">
            <PeerChip name={mirror.sourceName} type={mirror.sourceType} />
            <span className="text-muted-foreground">→</span>
            <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] max-sm:text-xs text-muted-foreground">
              {type}
            </span>
            <span className="text-muted-foreground">→</span>
            <PeerChip
              name={mirror.destinationName}
              type={mirror.destinationType}
            />
          </div>
        </div>
        <PhaseTimeline status={mirror.status} isCdc={isCdc} />
      </div>

      {/* peer info — GET /v1/peers/info/{name} */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Peer info
          </div>
          <span className="font-mono text-[10px] max-sm:text-xs text-muted-foreground">
            GET /v1/peers/info/&lt;name&gt;
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <PeerInfoCard
            name={mirror.sourceName}
            type={mirror.sourceType}
            peerRole="source"
          />
          <PeerInfoCard
            name={mirror.destinationName}
            type={mirror.destinationType}
            peerRole="destination"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Throughput
            </div>
            <div className="text-[10.5px] max-sm:text-xs tabular-nums text-muted-foreground">
              rows/min
            </div>
          </div>
          <div className="mb-1 text-[18px] font-bold tabular-nums">
            {pdbFmtNum(rowsPerSec * 60)}{' '}
            <span className="text-[11px] max-sm:text-xs font-medium text-muted-foreground">
              rpm
            </span>
          </div>
          <PdbAreaChart data={trend} color={meta.dot} height={100} />
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Replication lag
            </div>
            <div className="text-[10.5px] max-sm:text-xs tabular-nums text-muted-foreground">
              per batch
            </div>
          </div>
          <div
            className="mb-1 text-[18px] font-bold tabular-nums"
            style={lagSec && lagSec > 60 ? { color: '#f43f5e' } : undefined}
          >
            {pdbFmtLag(lagSec)}
          </div>
          <PdbAreaChart
            data={batchDurations}
            color={lagSec && lagSec > 60 ? '#f43f5e' : meta.dot}
            height={100}
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rows synced
            </div>
            <div className="text-[10.5px] max-sm:text-xs tabular-nums text-muted-foreground">
              cumulative
            </div>
          </div>
          <div className="mb-1 text-[18px] font-bold tabular-nums">
            {rowsSynced.toLocaleString()}
          </div>
          {type === 'QRep' ? (
            <div className="space-y-1.5 pt-1 text-[11px] max-sm:text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Partitions</span>
                <span className="font-mono tabular-nums">
                  {partitionsDone} / {partitions.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full"
                  style={{
                    width: `${partitions.length ? (partitionsDone / partitions.length) * 100 : 0}%`,
                    background: meta.dot,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between pt-2 text-[11px] max-sm:text-xs">
              <span className="text-muted-foreground">Batches (window)</span>
              <span className="font-mono tabular-nums">{batches.length}</span>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border bg-muted/40 px-3 pb-1.5 pt-2 text-[10px] max-sm:text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Configuration
        </div>
        <dl className="grid grid-cols-2 text-[11.5px] max-sm:text-xs md:grid-cols-3 lg:grid-cols-4">
          {fields.map((f) => (
            <ConfigField key={f.l} label={f.l} value={f.v} mono={f.mono} />
          ))}
        </dl>
      </div>

      {type === 'QRep' && partitions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3.5">
          <div className="flex items-center justify-between">
            <div className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Partition sync history
            </div>
            <div className="text-[10px] max-sm:text-xs text-muted-foreground">
              Rows synced at a point in time
            </div>
          </div>
          <PdbBarChart
            data={buildSyncHistory(partitions)}
            color={meta.dot}
            height={200}
            valueFormatter={pdbFmtNum}
          />
        </div>
      )}

      {type === 'QRep' && partitions.length > 0 && (
        <QRepPartitions partitions={partitions} />
      )}

      {/* mirror logs — POST /v1/mirrors/logs */}
      <MirrorLogsPanel flowJobName={mirror.name} />

      <div className="flex flex-wrap items-center gap-2">
        <AppLink
          href={`/peerdb/mirror?name=${encodeURIComponent(mirror.name)}`}
          className="inline-flex h-6 items-center gap-1.5 rounded-md bg-foreground px-1.5 text-[11px] max-sm:text-xs font-medium text-background hover:bg-foreground/90"
        >
          Open detail dashboard
        </AppLink>
      </div>
    </div>
  )
}
