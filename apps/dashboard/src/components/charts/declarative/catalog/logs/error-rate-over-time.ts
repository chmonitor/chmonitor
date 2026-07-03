import type { DeclarativeChart } from '../../schema'

/**
 * Declarative twin of `components/charts/logs/error-rate-over-time.tsx`
 * (`ChartErrorRateOverTime`) — ported as a template for plans/58, and the
 * catalog's multi-category + legend example.
 */
export const errorRateOverTimeDeclarative: DeclarativeChart = {
  type: 'area',
  chartName: 'error-rate-over-time',
  icon: 'alert-triangle',
  description: 'Error, warning, and info log volume over time',
  index: 'event_time',
  categories: ['error_count', 'warning_count', 'info_count'],
  defaultTitle: 'Error Rate Over Time',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'error-rate-over-time-chart',
  dateRangeConfig: 'realtime',
  areaChartProps: {
    readable: 'quantity',
    stack: true,
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-red', '--chart-yellow', '--chart-blue'],
    yAxisTickFormatterKey: 'count',
  },
}
