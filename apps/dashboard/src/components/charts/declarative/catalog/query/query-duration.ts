import type { DeclarativeChart } from '../../schema'

/**
 * Declarative twin of `components/charts/query/query-duration.tsx`
 * (`ChartQueryDuration`) — ported as a template for plans/58.
 */
export const queryDurationDeclarative: DeclarativeChart = {
  type: 'area',
  chartName: 'query-duration',
  icon: 'timer',
  description: 'Average query duration over time',
  index: 'event_time',
  categories: ['query_duration_s'],
  defaultTitle: 'Query Duration',
  defaultInterval: 'toStartOfDay',
  defaultLastHours: 24 * 14,
  dataTestId: 'query-duration-chart',
  dateRangeConfig: 'query-duration',
  areaChartProps: {
    colors: ['--chart-rose-200'],
    stack: true,
    showLegend: false,
    showXAxis: true,
    showCartesianGrid: true,
  },
}
