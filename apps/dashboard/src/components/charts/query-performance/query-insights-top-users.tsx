import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'
import { formatCount } from '@/lib/utils'

interface TopUsersData {
  user: string
  query_count: number
}

/** Tile 9 of the Query Insights overview: query volume by user. */
export const ChartQueryInsightsTopUsers = createCustomChart({
  chartName: 'query-insights-top-users',
  defaultTitle: 'Top Users',
  defaultLastHours: 24,
  dataTestId: 'query-insights-top-users-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as TopUsersData[]

    return (
      <ProportionList
        items={data.map((d, index) => ({
          label: d.user || 'Unknown',
          value: d.query_count,
          colorClass: `bg-chart-${(index % 5) + 1}`,
        }))}
        formatValue={(v) => formatCount(v)}
        emptyMessage="No query activity recorded"
      />
    )
  },
})

export default ChartQueryInsightsTopUsers
