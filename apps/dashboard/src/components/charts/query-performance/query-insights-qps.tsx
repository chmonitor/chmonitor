import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/** Tile 1 of the Query Insights overview: query volume as a rate (QPS). */
export const ChartQueryInsightsQps = createAreaChart({
  chartName: 'query-insights-qps',
  index: 'event_time',
  categories: ['qps'],
  defaultTitle: 'Queries / sec',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'query-insights-qps-chart',
  dateRangeConfig: 'query-activity',
  areaChartProps: {
    anomalyOverlay: { category: 'qps' },
    readable: 'number',
    stack: false,
    showLegend: false,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-1'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export default ChartQueryInsightsQps
