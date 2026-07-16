import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartMergedBytesOverTime = createAreaChart({
  chartName: 'traffic-merged-bytes',
  index: 'event_time',
  categories: ['merged_bytes'],
  defaultTitle: 'Data Merged',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-merged-bytes-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'bytes',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-4'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartMergedBytesOverTimeProps = ChartProps

export default ChartMergedBytesOverTime
