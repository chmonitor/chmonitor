import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/** Tile 7 of the Query Insights overview: avg + p95/p99 peak memory per query. */
export const ChartQueryInsightsMemory = createAreaChart({
  chartName: 'query-insights-memory',
  index: 'event_time',
  categories: ['avg_memory', 'p95_memory', 'p99_memory'],
  defaultTitle: 'Memory Usage',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'query-insights-memory-chart',
  dateRangeConfig: 'query-activity',
  areaChartProps: {
    anomalyOverlay: { category: 'avg_memory' },
    readable: 'bytes',
    stack: false,
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-1', '--chart-2', '--chart-3'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export default ChartQueryInsightsMemory
