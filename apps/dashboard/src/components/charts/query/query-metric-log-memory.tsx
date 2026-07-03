import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/**
 * Sampled query memory from system.query_metric_log.
 *
 * Plots the bucketed max(memory_usage) and max(peak_memory_usage) across all
 * queries over the window — the memory high-water mark as sampled by the metric
 * log (distinct from `query-memory`, which averages query_log's per-query
 * memory). Two overlapping, non-stacked byte series (peak >= current, so
 * stacking would double-count). Defaults to a short 6h window because
 * query_metric_log retention is typically short.
 */
export const ChartQueryMetricLogMemory = createAreaChart({
  chartName: 'query-metric-log-memory',
  index: 'event_time',
  categories: ['memory_usage', 'peak_memory_usage'],
  defaultTitle: 'Sampled Query Memory',
  defaultInterval: 'toStartOfFiveMinutes',
  defaultLastHours: 6,
  dataTestId: 'query-metric-log-memory-chart',
  areaChartProps: {
    stack: false,
    showLegend: true,
    showXAxis: true,
    showCartesianGrid: true,
    readableColumns: ['readable_memory_usage', 'readable_peak_memory_usage'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartQueryMetricLogMemoryProps = ChartProps

export default ChartQueryMetricLogMemory
