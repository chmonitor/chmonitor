import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/** Tile 4 of the Query Insights overview: rows read vs. rows returned. */
export const ChartQueryInsightsRows = createAreaChart({
  chartName: 'query-insights-rows',
  index: 'event_time',
  categories: ['read_rows', 'result_rows'],
  defaultTitle: 'Rows Read / Returned',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'query-insights-rows-chart',
  dateRangeConfig: 'query-activity',
  areaChartProps: {
    readable: 'quantity',
    stack: false,
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-blue-300', '--chart-orange-300'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export default ChartQueryInsightsRows
