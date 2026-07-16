import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartReplicaFetchTraffic = createAreaChart({
  chartName: 'traffic-replica-fetches',
  index: 'event_time',
  categories: ['fetched_bytes'],
  defaultTitle: 'Replica Fetch Traffic',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-replica-fetches-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'bytes',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-2'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartReplicaFetchTrafficProps = ChartProps

export default ChartReplicaFetchTraffic
