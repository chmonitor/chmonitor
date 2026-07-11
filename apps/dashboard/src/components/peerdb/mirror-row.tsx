import type { MirrorListItem } from '@/lib/peerdb/types'

import { MirrorExpanded } from './mirror-expanded'
import { phaseLabel } from './mirror-phase-timeline'
import { MirrorStatusPill } from './mirror-status-pill'
import { PdbSparkline } from './pdb-charts'
import { PeerChip } from './peer-chip'
import {
  DESIGN_STATUS_META,
  pdbFmtAgo,
  pdbFmtLag,
  pdbFmtNum,
  toDesignStatus,
} from './peerdb-utils'
import { partitionState } from './qrep-partitions'
import {
  type MirrorMetricsSummary,
  useMirrorMetrics,
} from './use-mirror-metrics'
import { useEffect, useId } from 'react'
import { cn } from '@/lib/utils'

export type { MirrorMetricsSummary } from './use-mirror-metrics'

interface MirrorRowProps {
  mirror: MirrorListItem
  expanded: boolean
  onToggle: () => void
  /** Fetch live metrics even when collapsed (eager for small lists). */
  loadMetrics?: boolean
  onMetrics?: (name: string, summary: MirrorMetricsSummary) => void
}

export function MirrorRow({
  mirror,
  expanded,
  onToggle,
  loadMetrics = false,
  onMetrics,
}: MirrorRowProps) {
  // Treat undefined `isCdc` as CDC consistently so labels and metrics agree.
  const isCdc = mirror.isCdc !== false
  const type = isCdc ? 'CDC' : 'QRep'
  const meta = DESIGN_STATUS_META[toDesignStatus(mirror.status)]
  const metrics = useMirrorMetrics(mirror.name, isCdc, loadMetrics || expanded)
  const { trend, rowsPerSec, rowsSynced, lagSec, partitions } = metrics
  const panelId = useId()

  const trendKey = trend.join(',')
  // Report metrics up so the page can aggregate KPI totals + lag triage (deduped fetch).
  // biome-ignore lint/correctness/useExhaustiveDependencies: trend tracked via trendKey
  useEffect(() => {
    onMetrics?.(mirror.name, { rowsPerSec, rowsSynced, trend, lagSec })
  }, [mirror.name, rowsPerSec, rowsSynced, trendKey, lagSec, onMetrics])

  const lagAccent =
    lagSec == null
      ? ''
      : lagSec > 60
        ? 'text-rose-600 dark:text-rose-400'
        : lagSec > 10
          ? 'text-amber-700 dark:text-amber-400'
          : ''

  const hasTrend = trend && trend.length >= 2
  const sparkData = hasTrend ? trend : [0, 0]
  const sparkFill =
    hasTrend &&
    mirror.status !== 'STATUS_PAUSED' &&
    mirror.status !== 'STATUS_FAILED'
      ? 0.28
      : 0

  return (
    <>
      <tr
        className="group cursor-pointer border-b border-border align-middle hover:bg-muted/40"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${mirror.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onToggle()
              }}
              className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-transform hover:bg-muted hover:text-foreground',
                expanded && 'rotate-90'
              )}
            >
              ›
            </button>
            <div className="min-w-0">
              <div className="truncate font-mono text-[12.5px] font-semibold">
                {mirror.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <MirrorStatusPill status={mirror.status} />
                <span className="text-[10px] text-muted-foreground">
                  {phaseLabel(mirror.status)}
                </span>
              </div>
            </div>
          </div>
        </td>

        <td className="hidden px-3 py-2.5 md:table-cell">
          <PeerChip name={mirror.sourceName} type={mirror.sourceType} />
        </td>

        <td className="hidden px-1 py-2.5 md:table-cell">
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-muted-foreground">→</span>
            <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
              {type}
            </span>
          </div>
        </td>

        <td className="hidden px-3 py-2.5 md:table-cell">
          <PeerChip
            name={mirror.destinationName}
            type={mirror.destinationType}
          />
        </td>

        <td className="hidden px-3 py-2.5 text-right lg:table-cell">
          <div className={cn('font-mono text-[12px] tabular-nums', lagAccent)}>
            {pdbFmtLag(lagSec)}
          </div>
        </td>

        <td className="hidden px-3 py-2.5 text-right lg:table-cell">
          <div className="font-mono text-[12px] tabular-nums">
            {rowsPerSec > 0 ? (
              pdbFmtNum(rowsPerSec)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            <span className="ml-0.5 text-[10.5px] text-muted-foreground">
              /s
            </span>
          </div>
        </td>

        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-3">
            <div className="text-right">
              <div className="font-mono text-[12.5px] font-semibold leading-tight tabular-nums">
                {pdbFmtNum(rowsSynced)}
              </div>
              <div className="text-[10px] leading-tight tabular-nums text-muted-foreground">
                {type === 'QRep'
                  ? `${partitions.filter((p) => partitionState(p) === 'done').length}/${partitions.length} parts`
                  : 'cumulative'}
              </div>
            </div>
            <div className="shrink-0">
              <PdbSparkline
                data={sparkData}
                color={meta.dot}
                width={120}
                height={32}
                fill={sparkFill}
              />
            </div>
          </div>
        </td>

        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right xl:table-cell">
          <div className="text-[11.5px] tabular-nums text-muted-foreground">
            {pdbFmtAgo(mirror.createdAt)}
          </div>
          <div className="text-[10px] text-muted-foreground/70">ago</div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0" id={panelId}>
            <MirrorExpanded mirror={mirror} metrics={metrics} />
          </td>
        </tr>
      )}
    </>
  )
}
