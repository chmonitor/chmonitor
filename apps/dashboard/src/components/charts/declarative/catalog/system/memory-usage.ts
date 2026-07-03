import type { DeclarativeChart } from '../../schema'

/**
 * Declarative twin of `components/charts/system/memory-usage.tsx`
 * (`ChartMemoryUsage`) — ported as a template for plans/58.
 */
export const memoryUsageDeclarative: DeclarativeChart = {
  type: 'area',
  chartName: 'memory-usage',
  icon: 'memory-stick',
  description: 'Average memory usage over time',
  index: 'event_time',
  categories: ['avg_memory'],
  defaultInterval: 'toStartOfTenMinutes',
  defaultLastHours: 24,
  dataTestId: 'memory-usage-chart',
  dateRangeConfig: 'system-metrics',
  areaChartProps: {
    colors: ['--chart-12'],
    yAxisTickFormatterKey: 'bytes',
  },
}
