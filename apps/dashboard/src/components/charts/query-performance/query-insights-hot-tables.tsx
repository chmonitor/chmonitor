import { createCustomChart } from '@/components/charts/factory'
import { RankBars } from '@/components/charts/primitives/rank-bars'
import { formatCount, formatDuration } from '@/lib/utils'

interface HotTablesData {
  table: string
  query_count: number
  avg_duration_ms: number
}

/** Hot tables drill-down: query volume + avg latency per referenced table (arrayJoin(tables)). */
export const ChartQueryInsightsHotTables = createCustomChart({
  chartName: 'query-insights-hot-tables',
  defaultTitle: 'Hot Tables',
  defaultLastHours: 24,
  dataTestId: 'query-insights-hot-tables-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as HotTablesData[]

    if (data.length === 0) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
          No table activity recorded
        </div>
      )
    }

    const maxCount = Math.max(...data.map((d) => d.query_count), 1)

    return (
      <RankBars
        items={data.map((d) => ({
          label: d.table,
          value: `${formatCount(d.query_count)} · avg ${formatDuration(d.avg_duration_ms)}`,
          pct: Math.max(4, (d.query_count / maxCount) * 100),
        }))}
      />
    )
  },
})

export default ChartQueryInsightsHotTables
