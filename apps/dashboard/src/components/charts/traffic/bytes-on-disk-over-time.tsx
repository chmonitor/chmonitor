import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartBytesOnDiskOverTime = createAreaChart({
  chartName: 'traffic-bytes-on-disk',
  index: 'event_time',
  categories: ['bytes_on_disk'],
  defaultTitle: 'Written to Disk (compressed)',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-bytes-on-disk-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'bytes',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-3'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartBytesOnDiskOverTimeProps = ChartProps

export default ChartBytesOnDiskOverTime
