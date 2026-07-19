import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartInsertPerformanceOverTime = createAreaChart({
  chartName: 'traffic-insert-performance',
  index: 'event_time',
  categories: ['avg_duration_ms', 'p95_duration_ms', 'p99_duration_ms'],
  defaultTitle: 'Insert Performance',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-insert-performance-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'duration',
    showXAxis: true,
    showCartesianGrid: true,
    showLegend: true,
    opacity: 0.25,
    colors: ['--chart-2', '--chart-red', '--chart-yellow'],
    yAxisTickFormatter: chartTickFormatters.duration,
  },
})

export type ChartInsertPerformanceOverTimeProps = ChartProps

export default ChartInsertPerformanceOverTime
