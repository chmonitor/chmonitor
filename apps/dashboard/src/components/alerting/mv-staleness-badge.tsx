'use client'

/**
 * MV Staleness Badge (#1925)
 *
 * A badge that shows the count of stale/failed materialized view refreshes.
 * Rendered in the view-refreshes page header. Dispatches an in-app alert
 * when failed/stale views are detected.
 */

import { AlertTriangle } from 'lucide-react'

import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  countMvIssues,
  formatMvStaleness,
  type MvRefreshRow,
} from '@/lib/alerting/mv-refresh-staleness'
import { dispatchAlert } from '@/lib/health/alert-dispatcher'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface MvStalenessBadgeProps {
  hostId: number
  className?: string
}

/**
 * MvStalenessBadge — shows a count badge when failed/stale MV refreshes exist.
 * Invisible when all views are healthy.
 */
export function MvStalenessBadge({ hostId, className }: MvStalenessBadgeProps) {
  const { data, isLoading } = useChartData<MvRefreshRow>({
    chartName: 'mv-staleness',
    hostId,
    refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
  })

  const rows: MvRefreshRow[] = Array.isArray(data) ? data : []
  const { failed, stale } = countMvIssues(rows)
  const total = failed + stale

  // Dispatch alert when issues are found
  useEffect(() => {
    if (total === 0) return
    void dispatchAlert({
      checkId: 'mv-refresh-failures',
      title: 'MV Refresh Failures',
      severity: failed > 0 ? 'critical' : 'warning',
      value: total,
      label: `${failed} failed, ${stale} stale materialized view${total === 1 ? '' : 's'}`,
      hostId,
      incidentId: `mvr-${hostId}-${Math.floor(Date.now() / 300_000)}`,
    })
  }, [total, failed, stale, hostId])

  if (isLoading || total === 0) return null

  const label = [
    failed > 0 && `${failed} failed`,
    stale > 0 && `${stale} stale`,
  ]
    .filter(Boolean)
    .join(', ')

  const worstRow = rows
    .filter(
      (r) =>
        r.status === 'Error' ||
        r.status === 'Failed' ||
        r.staleness_seconds > 3600
    )
    .sort(
      (a, b) => Number(b.staleness_seconds) - Number(a.staleness_seconds)
    )[0]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn(
              'inline-flex items-center gap-1 cursor-default select-none',
              failed > 0
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-300',
              className
            )}
          />
        }
      >
        <AlertTriangle className="size-3" />
        {label}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-60 text-xs">
        {total} materialized view{total === 1 ? '' : 's'} need attention.
        {worstRow && (
          <span className="block mt-1 font-mono">
            Worst: {worstRow.database}.{worstRow.view} (
            {formatMvStaleness(Number(worstRow.staleness_seconds))} stale)
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
