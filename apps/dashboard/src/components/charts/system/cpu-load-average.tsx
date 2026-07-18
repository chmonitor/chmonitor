import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/**
 * Load average (1m/5m/15m) plotted alongside the logical CPU core count, so
 * "load above cores" reads as saturation at a glance.
 */
export const ChartCpuLoadAverage = createAreaChart({
  chartName: 'cpu-load-average',
  index: 'event_time',
  categories: [
    'load_average_1m',
    'load_average_5m',
    'load_average_15m',
    'cpu_cores',
  ],
  defaultTitle: 'Load Average vs CPU Cores',
  defaultInterval: 'toStartOfTenMinutes',
  defaultLastHours: 24,
  dataTestId: 'cpu-load-average-chart',
  dateRangeConfig: 'system-metrics',
  areaChartProps: {
    stack: false,
    showLegend: true,
    colors: ['--chart-1', '--chart-2', '--chart-3', '--chart-5'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartCpuLoadAverageProps = ChartProps

export default ChartCpuLoadAverage
