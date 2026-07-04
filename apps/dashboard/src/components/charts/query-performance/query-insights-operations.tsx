import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'

interface OperationsData {
  query_kind: string
  query_count: number
}

const queryKindColors: Record<string, string> = {
  Select: 'bg-emerald-500',
  Insert: 'bg-blue-500',
  Create: 'bg-indigo-500',
  Alter: 'bg-amber-500',
  Drop: 'bg-red-500',
  Rename: 'bg-purple-500',
  Optimize: 'bg-cyan-500',
  System: 'bg-gray-500',
}

/** Tile 3 of the Query Insights overview: operations breakdown by query_kind. */
export const ChartQueryInsightsOperations = createCustomChart({
  chartName: 'query-insights-operations',
  defaultTitle: 'Operations Breakdown',
  defaultLastHours: 24,
  dataTestId: 'query-insights-operations-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as OperationsData[]

    return (
      <ProportionList
        items={data.map((d, index) => ({
          label: d.query_kind || 'Unknown',
          value: d.query_count,
          colorClass:
            queryKindColors[d.query_kind] ?? `bg-chart-${(index % 5) + 1}`,
        }))}
        emptyMessage="No query operations recorded"
      />
    )
  },
})

export default ChartQueryInsightsOperations
