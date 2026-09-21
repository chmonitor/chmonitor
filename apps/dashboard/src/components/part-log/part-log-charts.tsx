import { HardDrive, Layers, Merge, RefreshCw, Sparkles } from 'lucide-react'

import type { CardError } from '@/lib/card-error-utils'
import type { PartLogRow } from './lib'
import type { DonutSegment, LifecyclePoint } from './part-log-charts-parts'

import {
  formatReadableQuantity,
  formatReadableSize,
  num,
  SIZE_BINS,
  TONE_COLOR,
} from './lib'
import {
  ChartCard,
  ChurnBars,
  Donut,
  Kpi,
  LegendDot,
  LifecycleChart,
  labelClass,
  SizeHistogram,
} from './part-log-charts-parts'
import { derivePartLogData } from './part-log-derive'
import { ChartStaleIndicator } from '@/components/charts/chart-stale-indicator'
import { EmptyState } from '@/components/ui/empty-state'
import {
  detectCardErrorVariant,
  getCardErrorDescription,
  getCardErrorTitle,
  toEmptyStateVariant,
} from '@/lib/card-error-utils'
import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { useHostId } from '@/lib/swr/use-host'

export type { PartLogKpis } from './part-log-derive'

export { derivePartLogData } from './part-log-derive'

export function PartLogCharts({ rows }: { rows: PartLogRow[] }) {
  const hostId = useHostId()
  const lifecycleSwr = useChartData<LifecyclePoint>({
    chartName: 'part-log-lifecycle',
    hostId,
    interval: 'toStartOfHour',
    lastHours: 24,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  const {
    kpis,
    reasonCounts,
    churnRows,
    sizeBins,
    sizeMedian,
    sizePctBelow64,
  } = derivePartLogData(rows)

  const lifecycleData = (lifecycleSwr.data ?? []).map((d) => ({
    event_time: String(d.event_time),
    new_parts: num(d.new_parts),
    merges: num(d.merges),
    mutations: num(d.mutations),
    removals: num(d.removals),
  }))

  const lifecycleError = lifecycleSwr.error as CardError | undefined
  const lifecycleErrorVariant = lifecycleError
    ? detectCardErrorVariant(lifecycleError)
    : 'error'
  const retryLifecycle = () => void lifecycleSwr.mutate()

  const reasonSegments: DonutSegment[] = [
    {
      label: 'Regular',
      value: reasonCounts.RegularMerge,
      color: TONE_COLOR.green,
    },
    {
      label: 'TTL delete',
      value: reasonCounts.TTLDeleteMerge,
      color: TONE_COLOR.amber,
    },
    {
      label: 'TTL recompress',
      value: reasonCounts.TTLRecompressMerge,
      color: TONE_COLOR.violet,
    },
    {
      label: 'Not a merge',
      value: reasonCounts.NotAMerge,
      color: TONE_COLOR.neutral,
    },
  ]
  const mergeTotal =
    reasonCounts.RegularMerge +
    reasonCounts.TTLDeleteMerge +
    reasonCounts.TTLRecompressMerge

  // Pick ~6 evenly-spaced x labels for the lifecycle axis.
  const axisLabels = lifecycleData.filter(
    (_, i) => i % Math.max(1, Math.ceil(lifecycleData.length / 6)) === 0
  )

  return (
    <div className="flex flex-col gap-3">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Total events"
          value={formatReadableQuantity(kpis.totalEvents)}
          sub={`across ${kpis.tableCount} ${kpis.tableCount === 1 ? 'table' : 'tables'}`}
          icon={Layers}
        />
        <Kpi
          label="New parts"
          value={formatReadableQuantity(kpis.newParts)}
          sub={`avg ${formatReadableSize(kpis.newAvgSize)} · inserts`}
          icon={Sparkles}
          accent={TONE_COLOR.green}
        />
        <Kpi
          label="Merges"
          value={formatReadableQuantity(kpis.merges)}
          sub={`${kpis.mergeRegularPct}% regular · ${kpis.mergeTtlPct}% TTL`}
          icon={Merge}
          accent={TONE_COLOR.violet}
        />
        <Kpi
          label="Reclaimed"
          value={formatReadableSize(kpis.reclaimedBytes)}
          sub={`${formatReadableQuantity(kpis.removedParts)} parts removed`}
          icon={HardDrive}
          accent={TONE_COLOR.rose}
        />
      </div>

      {/* Charts row A */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className={labelClass}>Part lifecycle</div>
              <div className="mt-0.5 text-[13px] font-semibold">
                Events by type · last 24 hours
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
              <LegendDot color={TONE_COLOR.green} label="New" />
              <LegendDot color={TONE_COLOR.violet} label="Merge" />
              <LegendDot color={TONE_COLOR.amber} label="Mutate" />
              <LegendDot color={TONE_COLOR.rose} label="Remove" />
              {lifecycleSwr.staleError && (
                <ChartStaleIndicator
                  error={lifecycleSwr.staleError}
                  onRetry={retryLifecycle}
                  alwaysVisible
                />
              )}
            </div>
          </div>
          {lifecycleError && lifecycleData.length === 0 ? (
            <EmptyState
              variant={toEmptyStateVariant(lifecycleErrorVariant)}
              title={getCardErrorTitle(lifecycleErrorVariant)}
              description={getCardErrorDescription(
                lifecycleError,
                lifecycleErrorVariant,
                true
              )}
              compact
              className="h-[172px] justify-center"
              action={{
                label: 'Retry',
                onClick: retryLifecycle,
                icon: <RefreshCw className="mr-1.5 size-3.5" />,
              }}
            />
          ) : lifecycleData.length > 0 ? (
            <>
              <LifecycleChart data={lifecycleData} />
              <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                {axisLabels.map((d) => (
                  <span key={d.event_time}>
                    {d.event_time.match(/(\d{2}):\d{2}/)?.[1] ?? ''}h
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-[172px] items-center justify-center text-[12px] text-muted-foreground">
              No lifecycle data in the last 24 hours
            </div>
          )}
        </ChartCard>

        <ChartCard>
          <div className={labelClass}>Merge reasons</div>
          <div className="mb-2 mt-0.5 text-[13px] font-semibold">
            {formatReadableQuantity(mergeTotal)} merges
          </div>
          <div className="flex items-center gap-4">
            <Donut
              segments={reasonSegments.filter((s) => s.label !== 'Not a merge')}
              center={{
                value: formatReadableQuantity(mergeTotal),
                label: 'merges',
              }}
            />
            <div className="min-w-0 flex-1 space-y-2">
              {reasonSegments.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-2 text-[11.5px]"
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ background: s.color }}
                    />
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatReadableQuantity(s.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      {/* Charts row B */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className={labelClass}>Part churn by table</div>
              <div className="mt-0.5 text-[13px] font-semibold">
                Part events in window
              </div>
            </div>
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              top {churnRows.length}
            </span>
          </div>
          {churnRows.length > 0 ? (
            <ChurnBars rows={churnRows} />
          ) : (
            <div className="py-6 text-center text-[12px] text-muted-foreground">
              No part events
            </div>
          )}
        </ChartCard>

        <ChartCard>
          <div className={labelClass}>Part size distribution</div>
          <div className="mb-2 mt-0.5 text-[13px] font-semibold">
            median{' '}
            <span className="font-mono">{formatReadableSize(sizeMedian)}</span>{' '}
            ·{' '}
            <span className="text-rose-600 dark:text-rose-400">
              {sizePctBelow64}% &lt; 64 KiB
            </span>
          </div>
          <SizeHistogram bins={sizeBins} />
          <div className="mt-1 flex justify-between text-[9px] tabular-nums text-muted-foreground">
            {SIZE_BINS.map((b) => (
              <span key={b.label}>{b.label}</span>
            ))}
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
