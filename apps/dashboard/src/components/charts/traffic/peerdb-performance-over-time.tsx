import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartPeerdbPerformanceOverTime = createAreaChart({
  chartName: 'traffic-peerdb-performance',
  index: 'event_time',
  categories: ['avg_duration_ms', 'p95_duration_ms', 'p99_duration_ms'],
  defaultTitle: 'PeerDB Insert Performance',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-peerdb-performance-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'duration',
    showXAxis: true,
    showCartesianGrid: true,
    showLegend: true,
    opacity: 0.25,
    colors: ['--chart-2', '--chart-red', '--chart-yellow'],
    yAxisTickFormatter: chartTickFormatters.duration,
  },
})

export type ChartPeerdbPerformanceOverTimeProps = ChartProps

export default ChartPeerdbPerformanceOverTime
