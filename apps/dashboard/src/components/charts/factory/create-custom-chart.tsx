import type { ChartProps } from '@/components/charts/chart-props'
import type { UseChartResult } from '@/lib/query/use-chart-data'
import type { CustomChartFactoryConfig } from './types'

import { type FC, memo } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { useGroupedChartData } from '@/lib/query/use-chart-grouping'
import { useChartData, useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

interface CustomChartBodyProps extends ChartProps {
  config: CustomChartFactoryConfig
  swr: UseChartResult
  hostId: number
  lastHours: number | undefined
}

function CustomChartBody({
  config,
  swr,
  hostId,
  lastHours,
  title = config.defaultTitle,
  className,
  chartCardContentClassName,
  href,
}: CustomChartBodyProps) {
  return (
    <ChartContainer swr={swr} title={title} className={className}>
      {(dataArray, sql, metadata) => (
        <ChartCard
          title={title}
          className={cn(config.chartCardClassName, className)}
          contentClassName={cn(
            config.contentClassName,
            chartCardContentClassName
          )}
          sql={sql}
          data={dataArray}
          metadata={metadata}
          data-testid={config.dataTestId}
          href={href}
        >
          {config.render(dataArray, sql, hostId, lastHours)}
        </ChartCard>
      )}
    </ChartContainer>
  )
}

/**
 * Factory function to create a custom chart component with consistent patterns
 */
export function createCustomChart(
  config: CustomChartFactoryConfig
): FC<ChartProps> {
  const GroupedCustomChart = memo(function GroupedCustomChart(
    props: ChartProps
  ) {
    const routeHostId = useHostId()
    const hostId = props.hostId ?? routeHostId
    const lastHours = props.lastHours ?? config.defaultLastHours
    const swr = useGroupedChartData({ chartName: config.chartName })

    return (
      <CustomChartBody
        {...props}
        config={config}
        swr={swr}
        hostId={hostId}
        lastHours={lastHours}
      />
    )
  })

  const IndividualCustomChart = memo(function IndividualCustomChart(
    props: ChartProps
  ) {
    const routeHostId = useHostId()
    const hostId = props.hostId ?? routeHostId
    const lastHours = props.lastHours ?? config.defaultLastHours
    const swr = useChartData({
      chartName: config.chartName,
      hostId,
      interval: props.interval ?? config.defaultInterval,
      lastHours,
      refreshInterval: config.refreshInterval,
    })

    return (
      <CustomChartBody
        {...props}
        config={config}
        swr={swr}
        hostId={hostId}
        lastHours={lastHours}
      />
    )
  })

  return memo(function Chart(props: ChartProps) {
    if (config.grouped) {
      return <GroupedCustomChart {...props} />
    }
    return <IndividualCustomChart {...props} />
  })
}
