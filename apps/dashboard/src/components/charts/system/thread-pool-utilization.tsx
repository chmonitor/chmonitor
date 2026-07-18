import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/**
 * Global thread pool saturation: active vs total threads, from
 * `system.metric_log`'s `CurrentMetric_GlobalThreadPool*` gauges.
 */
export const ChartThreadPoolUtilization = createAreaChart({
  chartName: 'thread-pool-utilization',
  index: 'event_time',
  categories: ['active_threads', 'total_threads'],
  defaultTitle: 'Thread Pool Utilization',
  defaultInterval: 'toStartOfTenMinutes',
  defaultLastHours: 24,
  dataTestId: 'thread-pool-utilization-chart',
  dateRangeConfig: 'system-metrics',
  areaChartProps: {
    stack: false,
    showLegend: true,
    colors: ['--chart-1', '--chart-3'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartThreadPoolUtilizationProps = ChartProps

export default ChartThreadPoolUtilization
