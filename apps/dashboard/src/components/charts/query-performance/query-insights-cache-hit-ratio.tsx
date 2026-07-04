import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'

interface CacheHitRatioData {
  hits: number
  misses: number
}

/**
 * Tile 5 of the Query Insights overview: MarkCache/UncompressedCache hits
 * vs. misses from `ProfileEvents`. Distinct from the Slow Query Patterns
 * `cache_hit_ratio` column, which is derived from `query_cache_usage`
 * (the query result cache, CH 24.1+).
 */
export const ChartQueryInsightsCacheHitRatio = createCustomChart({
  chartName: 'query-insights-cache-hit-ratio',
  defaultTitle: 'Cache Hit Ratio',
  defaultLastHours: 24,
  dataTestId: 'query-insights-cache-hit-ratio-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as CacheHitRatioData[]
    const row = data[0]

    return (
      <ProportionList
        items={[
          {
            label: 'Hits',
            value: row?.hits ?? 0,
            colorClass: 'bg-emerald-500',
          },
          {
            label: 'Misses',
            value: row?.misses ?? 0,
            colorClass: 'bg-red-500',
          },
        ]}
        emptyMessage="No cache activity recorded"
      />
    )
  },
})

export default ChartQueryInsightsCacheHitRatio
