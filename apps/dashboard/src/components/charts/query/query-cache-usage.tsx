import type { ChartProps } from '@/components/charts/chart-props'

import { CHART_BG_CLASSES } from '@/components/charts/chart-bg-classes'
import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'

interface CacheUsageData {
  query_cache_usage: string
  query_count: number
  percentage: number
}

const cacheColors: Record<string, string> = {
  None: 'bg-gray-400 dark:bg-gray-500',
  Read: 'bg-emerald-500 dark:bg-emerald-400',
  Write: 'bg-blue-500 dark:bg-blue-400',
}

/**
 * Query Cache Usage Chart
 * Shows query cache hit rate breakdown by usage type (Read, Write, None)
 * Available in ClickHouse v24.1+
 */
export const ChartQueryCacheUsage = createCustomChart({
  chartName: 'query-cache-usage',
  defaultTitle: 'Query Cache Hit Rate',
  defaultLastHours: 24 * 7,
  dataTestId: 'query-cache-usage-chart',
  dateRangeConfig: 'standard',
  render: (dataArray) => {
    const data = dataArray as CacheUsageData[]

    return (
      <ProportionList
        items={data.map((d) => ({
          label: d.query_cache_usage,
          value: d.query_count,
          colorClass: cacheColors[d.query_cache_usage] ?? CHART_BG_CLASSES[0],
        }))}
        emptyMessage="No cache usage data available"
      />
    )
  },
})

export type ChartQueryCacheUsageProps = ChartProps

export default ChartQueryCacheUsage
