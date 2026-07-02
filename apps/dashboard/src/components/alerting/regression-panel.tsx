'use client'

/**
 * Slow Query Regression Panel (#1921)
 *
 * Fetches the regression-detection chart and surfaces any fingerprints
 * whose P95 duration has degraded significantly vs the baseline window.
 * Feeds the alert engine via dispatchAlert() when regressions are found.
 */

import { AlertTriangle, TrendingUp } from 'lucide-react'

import type { SlowQueryRegression } from '@/lib/alerting/slow-query-regression'

import { useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { dispatchAlert } from '@/lib/health/alert-dispatcher'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface RegressionPanelProps {
  hostId: number
  className?: string
}

/**
 * RegressionPanel — renders a card listing slow-query fingerprints that
 * have regressed (current P95 ≥ 2× baseline P95). Dispatches an in-app
 * alert whenever at least one regression is detected.
 */
export function RegressionPanel({ hostId, className }: RegressionPanelProps) {
  const { data, isLoading, error } = useChartData<SlowQueryRegression>({
    chartName: 'slow-query-regressions',
    hostId,
    refreshInterval: REFRESH_INTERVAL.DEFAULT_60S,
  })

  const rows: SlowQueryRegression[] = Array.isArray(data) ? data : []

  // Per-minute bucket so an ongoing regression re-alerts each minute, and a
  // content signature so the effect re-runs when the worst factor changes.
  const minuteBucket = Math.floor(Date.now() / 60_000)
  const worstFactor = rows.length
    ? Math.max(...rows.map((r) => r.regression_factor))
    : 0

  // Fire an alert whenever regressions are detected, deduped by incidentId.
  useEffect(() => {
    if (rows.length === 0) return
    void dispatchAlert({
      checkId: 'slow-query-regression',
      title: 'Slow Query Regression Detected',
      severity: worstFactor >= 5 ? 'critical' : 'warning',
      value: rows.length,
      label: `${rows.length} fingerprint${rows.length === 1 ? '' : 's'} regressed — worst: ${worstFactor}× slower`,
      hostId,
      incidentId: `sqr-${hostId}-${minuteBucket}`,
    })
  }, [hostId, rows.length, worstFactor, minuteBucket])

  if (isLoading) return null
  if (error || rows.length === 0) return null

  return (
    <Card
      className={cn(
        'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20',
        className
      )}
    >
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <TrendingUp className="size-4" />
          Slow Query Regressions
          <Badge
            variant="outline"
            className="ml-auto h-5 border-amber-400 bg-amber-100 px-1.5 text-[10px] text-amber-700 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-300"
          >
            {rows.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <p className="mb-2 text-xs text-muted-foreground">
          Fingerprints whose P95 duration has regressed ≥2× vs the prior 24h
          baseline.
        </p>
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 5).map((row, i) => (
            <RegressionRow key={i} row={row} />
          ))}
          {rows.length > 5 && (
            <p className="text-[11px] text-muted-foreground">
              +{rows.length - 5} more regressions
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function RegressionRow({ row }: { row: SlowQueryRegression }) {
  const factor = Number(row.regression_factor)
  const isCritical = factor >= 5

  return (
    <div className="flex items-start gap-2 rounded-md bg-background/60 px-2.5 py-2 text-xs">
      <AlertTriangle
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          isCritical ? 'text-destructive' : 'text-amber-600'
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-mono text-[11px] text-foreground"
          title={row.fingerprint_short as string}
        >
          {row.fingerprint_short}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          P95: {Number(row.baseline_p95_ms).toLocaleString()}ms →{' '}
          <span
            className={cn(
              'font-medium',
              isCritical
                ? 'text-destructive'
                : 'text-amber-700 dark:text-amber-400'
            )}
          >
            {Number(row.current_p95_ms).toLocaleString()}ms
          </span>{' '}
          ({factor}×)
        </p>
      </div>
      <Badge
        variant="outline"
        className={cn(
          'shrink-0 h-5 px-1.5 text-[10px]',
          isCritical
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-300'
        )}
      >
        {factor}×
      </Badge>
    </div>
  )
}
