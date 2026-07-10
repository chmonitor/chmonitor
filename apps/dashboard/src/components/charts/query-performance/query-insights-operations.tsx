import { CHART_BG_CLASSES } from '@/components/charts/chart-bg-classes'
import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'

interface OperationsData {
  query_kind: string
  query_count: number
}

const queryKindColors: Record<string, string> = {
  Select: 'bg-emerald-500 dark:bg-emerald-400',
  Insert: 'bg-blue-500 dark:bg-blue-400',
  Create: 'bg-indigo-500 dark:bg-indigo-400',
  Alter: 'bg-amber-500 dark:bg-amber-400',
  Drop: 'bg-red-500 dark:bg-red-400',
  Rename: 'bg-purple-500 dark:bg-purple-400',
  Optimize: 'bg-cyan-500 dark:bg-cyan-400',
  System: 'bg-gray-500 dark:bg-gray-400',
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
            queryKindColors[d.query_kind] ??
            CHART_BG_CLASSES[index % CHART_BG_CLASSES.length],
        }))}
        emptyMessage="No query operations recorded"
      />
    )
  },
})

export default ChartQueryInsightsOperations
