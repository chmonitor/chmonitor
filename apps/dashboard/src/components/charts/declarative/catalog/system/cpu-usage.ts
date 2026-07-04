import type { DeclarativeChart } from '../../schema'

/**
 * Declarative twin of `components/charts/system/cpu-usage.tsx`
 * (`ChartCPUUsage`) — ported as a template for plans/58.
 */
export const cpuUsageDeclarative: DeclarativeChart = {
  type: 'area',
  chartName: 'cpu-usage',
  icon: 'cpu',
  description: 'Average CPU usage over time',
  index: 'event_time',
  categories: ['avg_cpu'],
  defaultInterval: 'toStartOfTenMinutes',
  defaultLastHours: 24,
  dataTestId: 'cpu-usage-chart',
  dateRangeConfig: 'system-metrics',
  areaChartProps: {
    colors: ['--chart-1'],
    yAxisTickFormatterKey: 'duration',
  },
}
