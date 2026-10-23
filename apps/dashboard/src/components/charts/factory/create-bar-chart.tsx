import type { ChartProps } from '@/components/charts/chart-props'
import type { DateRangeValue } from '@/components/date-range'
import type { ChartDataPoint } from '@/types/chart-data'
import type { BarChartFactoryConfig } from './types'

import { type FC, memo, useMemo, useState } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { BarChart } from '@/components/charts/primitives/bar/bar'
import { resolveDateRangeConfig } from '@/components/date-range'
import { useTimeRange } from '@/lib/context/time-range-context'
import { useTimezone } from '@/lib/context/timezone-context'
import { useChartData, useHostId } from '@/lib/swr'
import { cn, createDateTickFormatter } from '@/lib/utils'

/** True when the data has rows but every value in `categories` is zero or empty. */
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

/** Creates a BarChart component with the shared loading/error/empty handling. */
export function createBarChart(config: BarChartFactoryConfig): FC<ChartProps> {
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
    params,
    ...props
  }: ChartProps) {
    const routeHostId = useHostId()
    const hostId = hostIdProp ?? routeHostId
    const userTimezone = useTimezone()
    const { timeRange } = useTimeRange()

    const [rangeOverride, setRangeOverride] = useState<DateRangeValue | null>(
      null
    )

    // Priority: per-chart date range override → explicit prop → global context → factory config default.
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
      refreshInterval: config.refreshInterval,
      params,
    })

    // biome-ignore lint/correctness/useExhaustiveDependencies: config is fixed for the factory instance.
    const categories = useMemo(() => {
      if (typeof config.categories === 'function') {
        return swr.data ? config.categories(swr.data) : []
      }
      return config.categories
    }, [swr.data, config.categories])

    const allZeros = useMemo(() => {
      if (!swr.data || swr.data.length === 0) return false
      return hasOnlyZeroValues(swr.data, categories)
    }, [swr.data, categories])

    // biome-ignore lint/correctness/useExhaustiveDependencies: config is fixed for the factory instance.
    const xAxisTickFormatter = useMemo(() => {
      if (!config.xAxisDateFormat) return undefined
      return createDateTickFormatter(effectiveLastHours ?? 24, userTimezone)
    }, [effectiveLastHours, userTimezone, config.xAxisDateFormat])

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
            contentClassName={chartCardContentClassName}
            href={href}
          >
            <BarChart
              className={cn(
                'h-full w-full',
                chartClassName,
                config.defaultChartClassName
              )}
              data={dataArray as ChartDataPoint[]}
              index={config.index}
              categories={categories}
              tickFormatter={xAxisTickFormatter}
              {...config.barChartProps}
              {...props}
            />
          </ChartCard>
        )}
      </ChartContainer>
    )
  })
}
