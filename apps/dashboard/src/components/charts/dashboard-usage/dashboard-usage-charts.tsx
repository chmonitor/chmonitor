import { createAreaChart, createBarChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/**
 * Charts of the Dashboard Usage pages. The page's day selector sets
 * `lastHours`, and `params.dashboard_user` narrows them to one user.
 */

export const ChartDashboardUsageQueries = createAreaChart({
  chartName: 'dashboard-usage-over-time',
  index: 'bucket',
  categories: ['queries', 'errors'],
  defaultTitle: 'Queries and Errors',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24 * 7,
  dataTestId: 'dashboard-usage-queries-chart',
  defaultChartClassName: 'h-[220px]',
  areaChartProps: {
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-1', '--chart-red'],
  },
})

export const ChartDashboardUsageP95 = createAreaChart({
  chartName: 'dashboard-usage-over-time',
  index: 'bucket',
  categories: ['p95_ms'],
  defaultTitle: 'p95 Duration (ms)',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24 * 7,
  dataTestId: 'dashboard-usage-p95-chart',
  defaultChartClassName: 'h-[220px]',
  enableScaleToggle: false,
  areaChartProps: {
    showLegend: false,
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-2'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

/** Top 10 of one attribution field; pass `params.dimension`. */
export const ChartDashboardUsageTop = createBarChart({
  chartName: 'dashboard-usage-top',
  index: 'name',
  categories: ['queries'],
  defaultTitle: 'Top',
  defaultLastHours: 24 * 7,
  dataTestId: 'dashboard-usage-top-chart',
  defaultChartClassName: 'h-[260px]',
  xAxisDateFormat: false,
  barChartProps: {
    layout: 'vertical',
    showLegend: false,
  },
})
