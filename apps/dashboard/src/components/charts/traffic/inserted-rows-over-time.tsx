import type { ChartProps } from '@/components/charts/chart-props'

import { createAreaChart } from '@/components/charts/factory'
import { chartTickFormatters } from '@/lib/utils'

export const ChartInsertedRowsOverTime = createAreaChart({
  chartName: 'traffic-inserted-rows',
  index: 'event_time',
  categories: ['inserted_rows'],
  defaultTitle: 'Rows Ingested',
  defaultInterval: 'toStartOfHour',
  defaultLastHours: 24,
  dataTestId: 'traffic-inserted-rows-chart',
  dateRangeConfig: 'operations',
  areaChartProps: {
    readable: 'quantity',
    showXAxis: true,
    showCartesianGrid: true,
    colors: ['--chart-1'],
    yAxisTickFormatter: chartTickFormatters.count,
  },
})

export type ChartInsertedRowsOverTimeProps = ChartProps

export default ChartInsertedRowsOverTime
