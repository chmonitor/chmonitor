import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeConfig, DateRangeValue } from '@/components/date-range'
import type { ChartDataPoint } from '@/types/chart-data'
import type { AreaChartDeploymentMarker } from '@/types/charts'
import type { AreaChartFactoryConfig } from './types'

import { type FC, memo, useMemo, useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { AreaChart } from '@/components/charts/primitives/area'
import { resolveDateRangeConfig } from '@/components/date-range'
import { useTimeRange } from '@/lib/context/time-range-context'
import { useTimezone } from '@/lib/context/timezone-context'
import { useDeployments } from '@/lib/deployments/use-deployments'
import { useChartData, useHostId } from '@/lib/swr'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { cn, createDateTickFormatter } from '@/lib/utils'

/**
 * Picks the smallest date-range preset that comfortably covers a deploy's
 * age (10% buffer for clock skew/render lag), falling back to the largest
 * preset. Powers the "filter to deploy window" marker click.
 *
 * Deliberately NOT a tight `[deploy, deploy+N min]` window: the chart's date
 * range is relative-from-now (`rangeOverride`/`onRangeChange`,
 * `DateRangeValue { lastHours, interval }`), with no absolute start/end.
 * Per plans/45-github-deploy-correlation.md — "reuse the chart's existing
 * time-range mechanism — do not build a new one" — this zooms to the
 * smallest existing preset that contains the deploy (ending at "now"),
 * rather than adding a new absolute-window control to get a tighter view.
 */
export function pickRangeForDeployment(
  deployedAtMs: number,
  dateRangeConfig: DateRangeConfig | undefined
): DateRangeValue | undefined {
  if (!dateRangeConfig || dateRangeConfig.options.length === 0) return undefined

  const ageHours = (Date.now() - deployedAtMs) / 3_600_000
  const sorted = [...dateRangeConfig.options].sort(
    (a, b) =>
      (a.lastHours ?? Number.POSITIVE_INFINITY) -
      (b.lastHours ?? Number.POSITIVE_INFINITY)
  )
  const match =
    sorted.find(
      (opt) => (opt.lastHours ?? Number.POSITIVE_INFINITY) >= ageHours * 1.1
    ) ?? sorted.at(-1)
  if (!match) return undefined

  return {
    value: match.value,
    lastHours: match.lastHours,
    interval: match.interval,
  }
}

/**
 * Check if all values in the specified categories are zero or empty
 * This helps detect when a chart has data rows but no meaningful values to display
 */
function hasOnlyZeroValues(
  data: Record<string, unknown>[],
  categories: string[]
): boolean {
  if (!data || data.length === 0) return false

  return data.every((row) =>
    categories.every((cat) => {
      const value = row[cat]
      return value === 0 || value === null || value === undefined
    })
  )
}

/**
 * Factory function to create an AreaChart component with consistent patterns
 *
 * Eliminates ~45 lines of duplicate code per chart component.
 *
 * @example
 * ```typescript
 * export const ChartCpuUsage = createAreaChart<{
 *   event_time: string
 *   cpu_usage: number
 * }>({
 *   chartName: 'cpu-usage',
 *   index: 'event_time',
 *   categories: ['cpu_usage'],
 * })
 * ```
 */
export function createAreaChart(
  config: AreaChartFactoryConfig
): FC<ChartProps> {
  // Resolve date range config once (stable reference)
  const resolvedDateRangeConfig = config.dateRangeConfig
    ? resolveDateRangeConfig(config.dateRangeConfig)
    : undefined

  return memo(function Chart({
    title = config.defaultTitle,
    interval,
    lastHours,
    className,
    chartClassName,
    chartCardContentClassName,
    hostId: hostIdProp,
    href,
    ...props
  }: ChartProps) {
    const routeHostId = useHostId()
    const hostId = hostIdProp ?? routeHostId
    const userTimezone = useTimezone()
    const { timeRange } = useTimeRange()

    // Date range state (only used when dateRangeConfig is provided)
    const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
      null
    )

    // Priority: per-chart date range override → explicit prop → global context → factory config default.
    // Charts that pass an explicit lastHours prop keep their value; charts without one follow
    // the global time-range picker so the header control affects all time-series charts.
    const effectiveLastHours =
      rangeOverride?.lastHours ??
      lastHours ??
      timeRange.lastHours ??
      config.defaultLastHours
    const effectiveInterval =
      rangeOverride?.interval ??
      interval ??
      timeRange.interval ??
      config.defaultInterval

    const swr = useChartData({
      chartName: config.chartName,
      hostId,
      interval: effectiveInterval,
      lastHours: effectiveLastHours,
      refreshInterval: config.refreshInterval ?? REFRESH_INTERVAL.DEFAULT_60S,
    })

    // Deploy-marker overlay (opt-in via config.showDeployments): fetch only
    // for the currently visible window, and only for charts that ask for it
    // — every other area chart pays zero extra query cost. `now` is bucketed
    // to the minute so the TanStack Query key (which includes sinceMs/untilMs)
    // stays stable across re-renders within that minute instead of
    // refetching on every render.
    const nowBucketMs = Math.floor(Date.now() / 60_000) * 60_000
    const { deployments } = useDeployments({
      sinceMs: effectiveLastHours
        ? nowBucketMs - effectiveLastHours * 3_600_000
        : undefined,
      untilMs: nowBucketMs,
      enabled: Boolean(config.showDeployments),
    })
    const deploymentMarkers: AreaChartDeploymentMarker[] | undefined =
      config.showDeployments
        ? deployments.map((d) => ({
            id: d.id,
            repo: d.repo,
            environment: d.environment,
            ref: d.ref,
            sha: d.sha,
            version: d.version,
            createdAt: d.createdAt,
          }))
        : undefined
    const handleDeploymentSelect = config.showDeployments
      ? (deployment: AreaChartDeploymentMarker) => {
          const range = pickRangeForDeployment(
            deployment.createdAt,
            resolvedDateRangeConfig
          )
          if (range) setRangeOverride(range)
        }
      : undefined

    // Create smart date formatter based on time range
    // Only apply if no custom tickFormatter is provided
    // biome-ignore lint/correctness/useExhaustiveDependencies: config is fixed for the factory instance.
    const tickFormatter = useMemo(() => {
      if (config.areaChartProps?.tickFormatter) {
        return config.areaChartProps.tickFormatter
      }
      return effectiveLastHours
        ? createDateTickFormatter(effectiveLastHours, userTimezone)
        : undefined
    }, [effectiveLastHours, userTimezone, config.areaChartProps?.tickFormatter])

    // Check if data has all zero values - show empty state with message
    // biome-ignore lint/correctness/useExhaustiveDependencies: config is fixed for the factory instance.
    const allZeros = useMemo(() => {
      if (!swr.data || swr.data.length === 0) return false
      return hasOnlyZeroValues(swr.data, config.categories)
    }, [swr.data, config.categories])

    // If data exists but all values are zero, show informative empty state
    if (allZeros && !swr.isLoading && !swr.error) {
      return (
        <ChartEmpty
          title={title}
          className={className}
          description="No values recorded in this time period"
          sql={swr.sql}
          data={swr.data}
          metadata={swr.metadata}
          onRetry={() => swr.mutate()}
          href={href}
        />
      )
    }

    return (
      <ChartContainer
        swr={swr}
        title={title}
        className={className}
        chartClassName={chartClassName}
      >
        {(dataArray, sql, metadata, staleError, mutate) => (
          <ChartCard
            title={title}
            sql={sql}
            data={dataArray}
            metadata={metadata}
            data-testid={config.dataTestId}
            dateRangeConfig={resolvedDateRangeConfig}
            currentRange={rangeOverride?.value}
            onRangeChange={
              resolvedDateRangeConfig ? setRangeOverride : undefined
            }
            staleError={staleError}
            onRetry={mutate}
            enableScaleToggle={config.enableScaleToggle}
            contentClassName={chartCardContentClassName}
            href={href}
          >
            <AreaChart
              className={cn(
                'h-full w-full',
                chartClassName,
                config.defaultChartClassName
              )}
              data={dataArray as ChartDataPoint[]}
              index={config.index}
              categories={config.categories}
              {...config.areaChartProps}
              tickFormatter={tickFormatter}
              deployments={deploymentMarkers}
              onDeploymentSelect={handleDeploymentSelect}
              {...props}
            />
          </ChartCard>
        )}
      </ChartContainer>
    )
  })
}
