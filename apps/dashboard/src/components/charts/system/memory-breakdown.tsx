import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

/**
 * RSS decomposition: memory tracked by queries/other, caches (mark +
 * uncompressed + query cache), background merges/mutations, and primary
 * keys/indexes. See `lib/api/charts/system-charts.ts` `'memory-breakdown'`
 * for the approximation methodology.
 */
export const ChartMemoryBreakdown = createAreaChart({
  chartName: 'memory-breakdown',
  index: 'event_time',
  categories: [
    'queries_memory',
    'caches_memory',
    'merges_memory',
    'primary_key_memory',
  ],
  defaultTitle: 'Memory Breakdown',
  defaultInterval: 'toStartOfTenMinutes',
  defaultLastHours: 24,
  dataTestId: 'memory-breakdown-chart',
  dateRangeConfig: 'system-metrics',
  areaChartProps: {
    stack: true,
    showLegend: true,
    colors: ['--chart-1', '--chart-2', '--chart-3', '--chart-4'],
    yAxisTickFormatter: chartTickFormatters.bytes,
  },
})

export type ChartMemoryBreakdownProps = ChartProps

export default ChartMemoryBreakdown
