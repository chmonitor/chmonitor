import { TriangleAlertIcon } from 'lucide-react'

import type { MirrorListItem } from '@/lib/peerdb/types'
import type { MirrorMetricsSummary } from './use-mirror-metrics'

import { pdbFmtLag } from './peerdb-utils'
import { AppLink } from '@/components/ui/app-link'

/** Lag past this (seconds) is worth surfacing in the triage strip. */
const LAG_FLOOR_SEC = 10
const TOP_N = 5

interface LagEntry {
  name: string
  lagSec: number
  source?: string
  destination?: string
}

/**
 * Worst-lag triage strip for the mirrors index. Ranks mirrors by the per-row
 * lag already derived (shared via `onMetrics`), surfaces the top offenders with
 * deep links to the mirror detail page. Renders nothing when no mirror is
 * meaningfully behind — a healthy fleet stays quiet.
 */
export function FleetLagTriage({
  mirrors,
  metrics,
}: {
  mirrors: MirrorListItem[]
  metrics: Record<string, MirrorMetricsSummary>
}) {
  const entries: LagEntry[] = mirrors
    .flatMap((m) => {
      const lag = metrics[m.name]?.lagSec
      if (lag == null || lag < LAG_FLOOR_SEC) return []
      return [
        {
          name: m.name,
          lagSec: lag,
          source: m.sourceName,
          destination: m.destinationName,
        },
      ]
    })
    .sort((a, b) => b.lagSec - a.lagSec)
    .slice(0, TOP_N)

  if (entries.length === 0) return null

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-center gap-2 border-b border-amber-200/70 px-3 py-2 dark:border-amber-500/20">
        <TriangleAlertIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
        <h2 className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
          Lag triage
        </h2>
        <span className="text-[11px] text-amber-700/80 dark:text-amber-400/70">
          {entries.length} mirror{entries.length === 1 ? '' : 's'} behind
        </span>
      </div>
      <ul className="divide-y divide-amber-200/60 dark:divide-amber-500/15">
        {entries.map((e) => {
          const critical = e.lagSec > 60
          return (
            <li key={e.name}>
              <AppLink
                href={`/peerdb/mirror?name=${encodeURIComponent(e.name)}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-amber-100/50 dark:hover:bg-amber-500/10"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[12px] font-semibold">
                    {e.name}
                  </span>
                  {(e.source || e.destination) && (
                    <span className="hidden truncate text-[10.5px] text-muted-foreground sm:inline">
                      {e.source ?? '—'} → {e.destination ?? '—'}
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 font-mono text-[12px] font-semibold tabular-nums ${
                    critical
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {pdbFmtLag(e.lagSec)}
                </span>
              </AppLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
