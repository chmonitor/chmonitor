import type { PercentileRow } from './percentile-distribution'

import { PercentileDistribution } from './percentile-distribution'
import { createCustomChart } from '@/components/charts/factory'
import { formatDuration } from '@/lib/utils'

/** Histogram tile: p10..p99 distribution of query_duration_ms. */
export const ChartQueryInsightsDurationDistribution = createCustomChart({
  chartName: 'query-insights-duration-distribution',
  defaultTitle: 'Duration Distribution',
  defaultLastHours: 24,
  dataTestId: 'query-insights-duration-distribution-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as PercentileRow[]
    return (
      <PercentileDistribution
        row={data[0]}
        formatValue={formatDuration}
        barColor="--chart-1"
      />
    )
  },
})

export default ChartQueryInsightsDurationDistribution
