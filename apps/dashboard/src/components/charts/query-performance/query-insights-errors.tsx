import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/** Tile 6 of the Query Insights overview: errors (exception_code != 0) over time. */
export const ChartQueryInsightsErrors = createAreaChart({
  chartName: 'query-insights-errors',
  index: 'event_time',
  categories: ['errors'],
  defaultTitle: 'Errors Over Time',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'query-insights-errors-chart',
  dateRangeConfig: 'query-activity',
  areaChartProps: {
    readable: 'number',
    stack: false,
    showLegend: false,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-orange-600'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export default ChartQueryInsightsErrors
