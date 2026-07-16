import type { ChartProps } from '@/components/charts/chart-props'

import { createBarChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartPartMovesOverTime = createBarChart({
  chartName: 'traffic-part-moves',
  index: 'event_time',
  categories: ['moves'],
  defaultTitle: 'Part Moves',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-part-moves-chart',
  dateRangeConfig: 'operations',
  xAxisDateFormat: true,
  barChartProps: {
    colors: ['--chart-5'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartPartMovesOverTimeProps = ChartProps

export default ChartPartMovesOverTime
