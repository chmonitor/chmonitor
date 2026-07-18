import type { PercentileRow } from './percentile-distribution'

import { PercentileDistribution } from './percentile-distribution'
import { createCustomChart } from '@/components/charts/factory'
import { formatBytes } from '@/lib/utils'

/** Histogram tile: p10..p99 distribution of peak memory_usage. */
export const ChartQueryInsightsMemoryDistribution = createCustomChart({
  chartName: 'query-insights-memory-distribution',
  defaultTitle: 'Memory Distribution',
  defaultLastHours: 24,
  dataTestId: 'query-insights-memory-distribution-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as PercentileRow[]
    return (
      <PercentileDistribution
        row={data[0]}
        formatValue={formatBytes}
        barColor="--chart-3"
      />
    )
  },
})

export default ChartQueryInsightsMemoryDistribution
