import { Flame, Gauge, Layers } from 'lucide-react'

import type { ExpensiveQueryRow } from './expensive-queries-table'

import { derive, type Severity } from './table/types'
import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatCompactNumber,
  formatReadableSecondDuration,
} from '@/lib/format-readable'
import { cn } from '@/lib/utils'

interface LoadSummaryProps {
  rows: ExpensiveQueryRow[]
}

const SEVERITY_META: Record<
  Severity,
  { label: string; bar: string; dot: string; text: string }
> = {
  critical: {
    label: 'Critical',
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
  warning: {
    label: 'Warning',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  normal: {
    label: 'Light',
    bar: 'bg-sky-500',
    dot: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
  },
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0
}

/**
 * LoadSummary — a compact "where the cluster's time goes" banner derived
 * entirely from the already-fetched expensive-query rows (no extra request).
 *
 * It contrasts *heavy* queries (critical + warning fingerprints) against the
 * *light* ones and shows how concentrated total query time is — i.e. how much
 * of the cluster's wall-clock load a handful of fingerprints actually drive.
 */
export function LoadSummary({ rows }: LoadSummaryProps) {
  const stats = useMemo(() => {
    const derived = rows.map(derive)
    const totalTime = derived.reduce((s, d) => s + d.queriesDuration, 0)
    const totalRuns = derived.reduce((s, d) => s + d.cnt, 0)

    const bucket: Record<Severity, { time: number; count: number }> = {
      critical: { time: 0, count: 0 },
      warning: { time: 0, count: 0 },
      normal: { time: 0, count: 0 },
    }
    for (const d of derived) {
      bucket[d.severity].time += d.queriesDuration
      bucket[d.severity].count += 1
    }

    const heavyTime = bucket.critical.time + bucket.warning.time
    const heavyCount = bucket.critical.count + bucket.warning.count

    // Concentration: share of total time taken by the top-N fingerprints.
    const byTime = [...derived].sort(
      (a, b) => b.queriesDuration - a.queriesDuration
    )
    const topN = Math.min(10, byTime.length)
    const topNTime = byTime
      .slice(0, topN)
      .reduce((s, d) => s + d.queriesDuration, 0)

    return {
      totalTime,
      totalRuns,
      bucket,
      heavyTime,
      heavyCount,
      fingerprints: derived.length,
      topN,
      topNTime,
    }
  }, [rows])

  if (stats.fingerprints === 0) return null

  const order: Severity[] = ['critical', 'warning', 'normal']

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {/* Heavy vs light — the headline contrast */}
      <Card className="rounded-xl lg:col-span-2">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Gauge className="size-3.5 text-primary" />
              Cluster query-time distribution
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {formatReadableSecondDuration(Math.round(stats.totalTime))} total
              · {formatCompactNumber(stats.totalRuns)} runs
            </span>
          </div>

          {/* Stacked share-of-time bar — heavy vs light at a glance */}
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {order.map((sev) => {
              const share = pct(stats.bucket[sev].time, stats.totalTime)
              if (share <= 0) return null
              return (
                <Tooltip key={sev}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          'h-full transition-all',
                          SEVERITY_META[sev].bar
                        )}
                        style={{ width: `${share}%` }}
                      />
                    }
                  />
                  <TooltipContent>
                    {SEVERITY_META[sev].label}:{' '}
                    {formatReadableSecondDuration(
                      Math.round(stats.bucket[sev].time)
                    )}{' '}
                    ({share.toFixed(1)}%)
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {/* Legend with per-bucket share */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {order.map((sev) => (
              <div key={sev} className="flex items-center gap-1.5">
                <span
                  className={cn('size-2 rounded-full', SEVERITY_META[sev].dot)}
                />
                <span className="text-[11px] text-muted-foreground">
                  {SEVERITY_META[sev].label}
                </span>
                <span
                  className={cn(
                    'text-[11px] font-medium tabular-nums',
                    SEVERITY_META[sev].text
                  )}
                >
                  {pct(stats.bucket[sev].time, stats.totalTime).toFixed(0)}%
                </span>
                <span className="text-[10.5px] tabular-nums text-muted-foreground">
                  · {stats.bucket[sev].count}{' '}
                  {stats.bucket[sev].count === 1 ? 'query' : 'queries'}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Two stat tiles: heavy share + concentration */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Card className="rounded-xl">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400">
              <Flame className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold tabular-nums leading-tight">
                {pct(stats.heavyTime, stats.totalTime).toFixed(0)}%
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                of cluster time from{' '}
                <span className="font-medium text-foreground">
                  {stats.heavyCount}
                </span>{' '}
                heavy {stats.heavyCount === 1 ? 'query' : 'queries'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400">
              <Layers className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="text-lg font-semibold tabular-nums leading-tight">
                {pct(stats.topNTime, stats.totalTime).toFixed(0)}%
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                concentrated in the top{' '}
                <span className="font-medium text-foreground">
                  {stats.topN}
                </span>{' '}
                fingerprints
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
