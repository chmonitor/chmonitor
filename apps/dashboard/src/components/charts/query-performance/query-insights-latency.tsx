import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/** Tile 2 of the Query Insights overview: mean + p50/p95/p99 duration. */
export const ChartQueryInsightsLatency = createAreaChart({
  chartName: 'query-insights-latency',
  index: 'event_time',
  categories: [
    'avg_duration_ms',
    'p50_duration_ms',
    'p95_duration_ms',
    'p99_duration_ms',
  ],
  defaultTitle: 'Query Latency',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'query-insights-latency-chart',
  dateRangeConfig: 'query-activity',
  areaChartProps: {
    readable: 'duration',
    stack: false,
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-1', '--chart-2', '--chart-3', '--chart-4'],
    yAxisTickFormatter: chartTickFormatters.duration,
  },
})

export default ChartQueryInsightsLatency
