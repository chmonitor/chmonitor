import type { ChartProps } from '@/components/charts/chart-props'

import { createBarChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartDistributedQueriesOverTime = createBarChart({
  chartName: 'traffic-distributed-queries',
  index: 'event_time',
  categories: ['initial_queries', 'secondary_queries'],
  defaultTitle: 'Distributed Queries',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-distributed-queries-chart',
  dateRangeConfig: 'operations',
  xAxisDateFormat: true,
  barChartProps: {
    stack: true,
    showLegend: true,
    colors: ['--chart-1', '--chart-3'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartDistributedQueriesOverTimeProps = ChartProps

export default ChartDistributedQueriesOverTime
