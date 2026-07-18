import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartIngestSpeedOverTime = createAreaChart({
  chartName: 'traffic-ingest-speed',
  index: 'event_time',
  categories: ['bytes_per_sec'],
  defaultTitle: 'Ingest Speed',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-ingest-speed-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'bytes',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-3'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartIngestSpeedOverTimeProps = ChartProps

export default ChartIngestSpeedOverTime
