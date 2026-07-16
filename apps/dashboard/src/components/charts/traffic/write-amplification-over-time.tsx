import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartWriteAmplificationOverTime = createAreaChart({
  chartName: 'traffic-write-amplification',
  index: 'event_time',
  categories: ['write_amplification'],
  defaultTitle: 'Write Amplification',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-write-amplification-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'number',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-red'],
    yAxisTickFormatter: chartTickFormatters.default,
  },
})

export type ChartWriteAmplificationOverTimeProps = ChartProps

export default ChartWriteAmplificationOverTime
