import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/** Tile 8 of the Query Insights overview: bytes read from storage vs returned. */
export const ChartQueryInsightsReadThroughput = createAreaChart({
  chartName: 'query-insights-read-throughput',
  index: 'event_time',
  categories: ['read_bytes', 'result_bytes'],
  defaultTitle: 'Read Throughput',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'query-insights-read-throughput-chart',
  dateRangeConfig: 'query-activity',
  areaChartProps: {
    anomalyOverlay: { category: 'read_bytes' },
    readable: 'bytes',
    stack: false,
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-1', '--chart-2'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export default ChartQueryInsightsReadThroughput
