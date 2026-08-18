import type { ChartProps } from '@/components/charts/chart-props'
import type { CustomChartFactoryConfig } from './types'

import { type FC, memo } from 'react'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { useChartData, useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

/**
 * Factory function to create a custom chart component with consistent patterns
 *
 * For charts that need custom rendering beyond AreaChart or BarChart.
 *
 * @example
 * ```typescript
 * export const ChartBackupSize = createCustomChart<{
 *   total_size: number
 *   readable_total_size: string
 * }>({
 *   chartName: 'backup-size',
 *   render: (data, sql) => <CardMetric {...data[0]} />,
 * })
 * ```
 */
export function createCustomChart(
  config: CustomChartFactoryConfig
): FC<ChartProps> {
  return memo(function Chart({
    title = config.defaultTitle,
    interval = config.defaultInterval,
    lastHours = config.defaultLastHours,
    className,
    chartCardContentClassName,
    hostId: hostIdProp,
    href,
  }: ChartProps) {
    const routeHostId = useHostId()
    const hostId = hostIdProp ?? routeHostId
    const swr = useChartData({
      chartName: config.chartName,
      hostId,
      interval,
      lastHours,
      refreshInterval: config.refreshInterval,
    })

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
  })
}
