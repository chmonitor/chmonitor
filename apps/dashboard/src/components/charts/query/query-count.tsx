import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartQueryCount = createAreaChart({
  chartName: 'query-count',
  index: 'event_time',
  categories: ['query_count'],
  defaultTitle: 'Query Count',
  defaultInterval: 'toStartOfDay',
  defaultLastHours: 24 * 14,
  dataTestId: 'query-count-chart',
  dateRangeConfig: 'query-activity',
  // Deploy correlation overlay (plans/45-github-deploy-correlation.md): query
  // volume is the identified timeline SREs correlate spikes/lag with releases
  // against.
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
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartQueryCountProps = ChartProps

export default ChartQueryCount
