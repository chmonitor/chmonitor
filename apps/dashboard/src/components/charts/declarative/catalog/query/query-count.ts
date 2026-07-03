import type { DeclarativeChart } from '../../schema'

/**
 * Declarative twin of `components/charts/query/query-count.tsx`
 * (`ChartQueryCount`) — ported as a template for plans/58. The hand-authored
 * TS chart is untouched; this definition renders through the exact same
 * `createAreaChart` factory call via `loadDeclarativeChart`/
 * `createChartFromDeclarative`.
 */
export const queryCountDeclarative: DeclarativeChart = {
  type: 'area',
  chartName: 'query-count',
  icon: 'bar-chart-3',
  description: 'Query volume over time, broken down by query kind',
  index: 'event_time',
  categories: ['query_count'],
  defaultTitle: 'Query Count',
  defaultInterval: 'toStartOfDay',
  defaultLastHours: 24 * 14,
  dataTestId: 'query-count-chart',
  dateRangeConfig: 'query-activity',
  showDeployments: true,
  areaChartProps: {
    readable: 'quantity',
    stack: true,
    showLegend: false,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-yellow'],
    breakdown: 'breakdown',
    breakdownLabel: 'query_kind',
    breakdownValue: 'count',
    yAxisTickFormatterKey: 'count',
  },
}
