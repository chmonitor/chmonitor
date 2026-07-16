import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartInsertedBytesOverTime = createAreaChart({
  chartName: 'traffic-inserted-bytes',
  index: 'event_time',
  categories: ['inserted_bytes'],
  defaultTitle: 'Data Ingested (uncompressed)',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-inserted-bytes-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'bytes',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-2'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartInsertedBytesOverTimeProps = ChartProps

export default ChartInsertedBytesOverTime
