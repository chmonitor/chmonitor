import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeConfig, DateRangeValue } from '@/components/date-range'
import type { UseChartResult } from '@/lib/query/use-chart-data'
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
import { useGroupedChartData } from '@/lib/query/use-chart-grouping'
import { useChartData, useHostId } from '@/lib/swr'
import { cn, createDateTickFormatter } from '@/lib/utils'

/**
 * Picks the smallest date-range preset that comfortably covers a deploy's
 * age (10% buffer for clock skew/render lag), falling back to the largest
 * preset. Powers the "filter to deploy window" marker click.
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

interface AreaChartBodyProps extends ChartProps {
  config: AreaChartFactoryConfig
  resolvedDateRangeConfig: DateRangeConfig | undefined
  swr: UseChartResult
  effectiveLastHours: number | undefined
  effectiveInterval: string | undefined
  rangeOverride: DateRangeValue | null
  setRangeOverride: (value: DateRangeValue | null) => void
}

function AreaChartBody({
  config,
  resolvedDateRangeConfig,
  swr,
  effectiveLastHours,
  className,
  chartClassName,
  chartCardContentClassName,
  title = config.defaultTitle,
  href,
  rangeOverride,
  setRangeOverride,
  ...props
}: AreaChartBodyProps) {
  const userTimezone = useTimezone()

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

  const tickFormatter = useMemo(() => {
    if (config.areaChartProps?.tickFormatter) {
      return config.areaChartProps.tickFormatter
    }
    return effectiveLastHours
      ? createDateTickFormatter(effectiveLastHours, userTimezone)
      : undefined
  }, [effectiveLastHours, userTimezone, config.areaChartProps?.tickFormatter])

  const allZeros = useMemo(() => {
    if (!swr.data || swr.data.length === 0) return false
    return hasOnlyZeroValues(swr.data, config.categories)
  }, [swr.data, config.categories])

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
          dateRangeConfig={config.grouped ? undefined : resolvedDateRangeConfig}
          currentRange={rangeOverride?.value}
          onRangeChange={
            config.grouped || !resolvedDateRangeConfig
              ? undefined
              : setRangeOverride
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
}

export function createAreaChart(
  config: AreaChartFactoryConfig
): FC<ChartProps> {
  const resolvedDateRangeConfig = config.dateRangeConfig
    ? resolveDateRangeConfig(config.dateRangeConfig)
    : undefined

  const GroupedAreaChart = memo(function GroupedAreaChart(props: ChartProps) {
    const { timeRange } = useTimeRange()
    const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
      null
    )
    const effectiveLastHours =
      rangeOverride?.lastHours ??
      props.lastHours ??
      timeRange.lastHours ??
      config.defaultLastHours
    const effectiveInterval =
      rangeOverride?.interval ??
      props.interval ??
      timeRange.interval ??
      config.defaultInterval
    const swr = useGroupedChartData({ chartName: config.chartName })

    return (
      <AreaChartBody
        {...props}
        config={config}
        resolvedDateRangeConfig={resolvedDateRangeConfig}
        swr={swr}
        effectiveLastHours={effectiveLastHours}
        effectiveInterval={effectiveInterval}
        rangeOverride={rangeOverride}
        setRangeOverride={setRangeOverride}
      />
    )
  })

  const IndividualAreaChart = memo(function IndividualAreaChart(
    props: ChartProps
  ) {
    const routeHostId = useHostId()
    const hostId = props.hostId ?? routeHostId
    const { timeRange } = useTimeRange()
    const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
      null
    )
    const effectiveLastHours =
      rangeOverride?.lastHours ??
      props.lastHours ??
      timeRange.lastHours ??
      config.defaultLastHours
    const effectiveInterval =
      rangeOverride?.interval ??
      props.interval ??
      timeRange.interval ??
      config.defaultInterval
    const swr = useChartData({
      chartName: config.chartName,
      hostId,
      interval: effectiveInterval,
      lastHours: effectiveLastHours,
      refreshInterval: config.refreshInterval,
    })

    return (
      <AreaChartBody
        {...props}
        config={config}
        resolvedDateRangeConfig={resolvedDateRangeConfig}
        swr={swr}
        effectiveLastHours={effectiveLastHours}
        effectiveInterval={effectiveInterval}
        rangeOverride={rangeOverride}
        setRangeOverride={setRangeOverride}
      />
    )
  })

  return memo(function Chart(props: ChartProps) {
    if (config.grouped) {
      return <GroupedAreaChart {...props} />
    }
    return <IndividualAreaChart {...props} />
  })
}
