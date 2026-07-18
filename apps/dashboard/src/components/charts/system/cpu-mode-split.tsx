import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/**
 * CPU mode split (user/system/iowait/idle), aggregated across all cores.
 * Degrades to the chart's all-zero empty state on platforms that don't
 * expose these OS-level asynchronous metrics.
 */
export const ChartCpuModeSplit = createAreaChart({
  chartName: 'cpu-mode-split',
  index: 'event_time',
  categories: ['user_time', 'system_time', 'iowait_time', 'idle_time'],
  defaultTitle: 'CPU Mode Split',
  defaultInterval: 'toStartOfTenMinutes',
  defaultLastHours: 24,
  dataTestId: 'cpu-mode-split-chart',
  dateRangeConfig: 'system-metrics',
  areaChartProps: {
    stack: true,
    showLegend: true,
    colors: ['--chart-1', '--chart-2', '--chart-yellow', '--chart-6'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartCpuModeSplitProps = ChartProps

export default ChartCpuModeSplit
