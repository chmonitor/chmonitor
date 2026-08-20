import { ChevronDownIcon } from 'lucide-react'

import type { MirrorListItem } from '@/lib/peerdb/types'
import type { PrefixGroup } from './group-by-prefix'
import type { MirrorMetricsSummary } from './use-mirror-metrics'

import { CountingNumber } from './counting-number'
import { PdbSparkline } from './pdb-charts'
import {
  DESIGN_STATUS_META,
  type DesignStatus,
  pdbFmtLag,
  pdbFmtNum,
  toDesignStatus,
} from './peerdb-utils'
import { cn } from '@/lib/utils'

function groupAnalytics(
  items: MirrorListItem[],
  metrics: Record<string, MirrorMetricsSummary>
) {
  const counts: Record<DesignStatus, number> = {
    running: 0,
    snapshotting: 0,
    paused: 0,
    failed: 0,
  }
  let rowsPerSec = 0
  let rowsSynced = 0
  let lagSec: number | null = null
  let trendLen = 0
  let measured = 0
  let cached = 0
  for (const m of items) {
    counts[toDesignStatus(m.status)]++
    const v = metrics[m.name]
    if (!v) continue
    measured++
    if (v.source === 'cache') cached++
    rowsPerSec += v.rowsPerSec
    rowsSynced += v.rowsSynced
    trendLen = Math.max(trendLen, v.trend.length)
    if (v.lagSec != null)
      lagSec = lagSec == null ? v.lagSec : Math.max(lagSec, v.lagSec)
  }
  const trend = Array.from({ length: trendLen }, (_, i) =>
    items.reduce((a, m) => a + (metrics[m.name]?.trend[i] ?? 0), 0)
  )
  return { counts, rowsPerSec, rowsSynced, lagSec, trend, measured, cached }
}

interface MirrorGroupHeaderProps {
  group: PrefixGroup<MirrorListItem>
  expanded: boolean
  onToggle: () => void
  metrics: Record<string, MirrorMetricsSummary>
  counting: boolean
}

/** Collapsible prefix-group row: wildcard name + aggregated job analytics. */
export function MirrorGroupHeader({
  group,
  expanded,
  onToggle,
  metrics,
  counting,
}: MirrorGroupHeaderProps) {
  const agg = groupAnalytics(group.items, metrics)
  const cached = agg.cached > 0 && agg.cached === agg.measured
  const statusBits = (
    ['running', 'snapshotting', 'paused', 'failed'] as DesignStatus[]
  ).filter((k) => agg.counts[k] > 0)

  return (
    <tr className="border-b border-border bg-muted/30">
      <td colSpan={8} className="p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-left hover:bg-muted/50"
        >
          <ChevronDownIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90'
            )}
          />
          <span className="font-mono text-[12.5px] font-semibold">
            {group.wildcard}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
            {group.items.length} jobs
          </span>
          <span className="flex items-center gap-1.5">
            {statusBits.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 text-[10.5px] tabular-nums text-muted-foreground"
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: DESIGN_STATUS_META[k].dot }}
                />
                {agg.counts[k]}
              </span>
            ))}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-4 text-[11.5px] tabular-nums">
            <span className="hidden sm:inline text-muted-foreground">
              lag{' '}
              <span className="font-medium text-foreground">
                {pdbFmtLag(agg.lagSec)}
              </span>
            </span>
            <span className="text-muted-foreground">
              <CountingNumber
                value={agg.rowsPerSec}
                counting={counting}
                cached={cached}
                className="font-medium text-foreground"
              />
              <span className="ml-0.5">/s</span>
            </span>
            <span className="text-muted-foreground">
              <CountingNumber
                value={agg.rowsSynced}
                counting={counting}
                cached={cached}
                format={pdbFmtNum}
                className="font-medium text-foreground"
              />{' '}
              rows
            </span>
            {agg.trend.length > 1 && (
              <PdbSparkline
                data={agg.trend}
                color={DESIGN_STATUS_META.running.dot}
                width={72}
                height={20}
                fill={0.22}
              />
            )}
          </span>
        </button>
      </td>
    </tr>
  )
}
