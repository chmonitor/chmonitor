import { CHART_BG_CLASSES } from '@/components/charts/chart-bg-classes'
import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'

interface QueryTypeData {
  type: string
  query_count: number
}

const typeColors: Record<string, string> = {
  QueryFinish: 'bg-emerald-500 dark:bg-emerald-400',
  QueryStart: 'bg-blue-500 dark:bg-blue-400',
  ExceptionBeforeStart: 'bg-red-500 dark:bg-red-400',
  ExceptionWhileProcessing: 'bg-orange-500 dark:bg-orange-400',
}

export const ChartQueryType = createCustomChart({
  chartName: 'query-type',
  defaultTitle: 'Query Type Distribution',
  defaultLastHours: 24,
  dataTestId: 'query-type-chart',
  dateRangeConfig: 'realtime',
  render: (dataArray) => {
    const data = dataArray as QueryTypeData[]

    return (
      <ProportionList
        items={data.map((d, index) => ({
          label: d.type,
          value: d.query_count,
          colorClass:
            typeColors[d.type] ??
            CHART_BG_CLASSES[index % CHART_BG_CLASSES.length],
        }))}
        emptyMessage="No query type data available"
      />
    )
  },
})

export default ChartQueryType
