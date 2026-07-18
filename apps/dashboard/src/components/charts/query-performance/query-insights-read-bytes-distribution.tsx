import type { PercentileRow } from './percentile-distribution'

import { PercentileDistribution } from './percentile-distribution'
import { createCustomChart } from '@/components/charts/factory'
import { formatBytes } from '@/lib/utils'

/** Histogram tile: p10..p99 distribution of read_bytes per query. */
export const ChartQueryInsightsReadBytesDistribution = createCustomChart({
  chartName: 'query-insights-read-bytes-distribution',
  defaultTitle: 'Read Bytes Distribution',
  defaultLastHours: 24,
  dataTestId: 'query-insights-read-bytes-distribution-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as PercentileRow[]
    return (
      <PercentileDistribution
        row={data[0]}
        formatValue={formatBytes}
        barColor="--chart-2"
      />
    )
  },
})

export default ChartQueryInsightsReadBytesDistribution
