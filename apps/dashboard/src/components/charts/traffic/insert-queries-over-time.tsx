import type { ChartProps } from '@/components/charts/chart-props'

import { createBarChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartInsertQueriesOverTime = createBarChart({
  chartName: 'traffic-insert-queries',
  index: 'event_time',
  categories: ['insert_queries', 'failed_inserts'],
  defaultTitle: 'Insert Queries',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-insert-queries-chart',
  dateRangeConfig: 'operations',
  xAxisDateFormat: true,
  barChartProps: {
    stack: true,
    showLegend: true,
    colors: ['--chart-4', '--chart-red'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartInsertQueriesOverTimeProps = ChartProps

export default ChartInsertQueriesOverTime
