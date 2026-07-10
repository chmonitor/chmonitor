import { CHART_BG_CLASSES } from '@/components/charts/chart-bg-classes'
import { createCustomChart } from '@/components/charts/factory'
import { ProportionList } from '@/components/charts/primitives/proportion-list'

interface LogLevelData {
  level: string
  count: number
}

const levelColors: Record<string, string> = {
  Fatal: 'bg-red-700 dark:bg-red-600',
  Critical: 'bg-red-500 dark:bg-red-400',
  Error: 'bg-orange-500 dark:bg-orange-400',
  Warning: 'bg-yellow-500 dark:bg-yellow-400',
  Notice: 'bg-blue-500 dark:bg-blue-400',
  Information: 'bg-emerald-500 dark:bg-emerald-400',
  Debug: 'bg-gray-500 dark:bg-gray-400',
  Trace: 'bg-gray-400 dark:bg-gray-500',
}

export const ChartLogLevelDistribution = createCustomChart({
  chartName: 'log-level-distribution',
  defaultTitle: 'Log Level Distribution',
  defaultLastHours: 24,
  dataTestId: 'log-level-distribution-chart',
  dateRangeConfig: 'realtime',
  render: (dataArray) => {
    const data = dataArray as LogLevelData[]

    return (
      <ProportionList
        items={data.map((d, index) => ({
          label: d.level,
          value: d.count,
          colorClass:
            levelColors[d.level] ??
            CHART_BG_CLASSES[index % CHART_BG_CLASSES.length],
        }))}
        emptyMessage="No log level data available"
      />
    )
  },
})

export default ChartLogLevelDistribution
