import type { PercentileRow } from './percentile-distribution'

import { PercentileDistribution } from './percentile-distribution'
import { createCustomChart } from '@/components/charts/factory'
import { formatCount } from '@/lib/utils'

/** Histogram tile: p10..p99 distribution of read_rows per query. */
export const ChartQueryInsightsReadRowsDistribution = createCustomChart({
  chartName: 'query-insights-read-rows-distribution',
  defaultTitle: 'Read Rows Distribution',
  defaultLastHours: 24,
  dataTestId: 'query-insights-read-rows-distribution-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as PercentileRow[]
    return (
      <PercentileDistribution
        row={data[0]}
        formatValue={formatCount}
        barColor="--chart-4"
      />
    )
  },
})

export default ChartQueryInsightsReadRowsDistribution
