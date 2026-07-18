import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartDiskWriteSpeedOverTime = createAreaChart({
  chartName: 'traffic-disk-write-speed',
  index: 'event_time',
  categories: ['new_part_bytes_per_sec', 'merge_bytes_per_sec'],
  defaultTitle: 'Disk Write Speed',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-disk-write-speed-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'bytes',
    showXAxis: true,
    showCartesianGrid: true,
    showLegend: true,
    opacity: 0.25,
    colors: ['--chart-1', '--chart-5'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartDiskWriteSpeedOverTimeProps = ChartProps

export default ChartDiskWriteSpeedOverTime
