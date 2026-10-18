import { getChartComponent } from '@/components/charts/chart-registry'
import { useHostId } from '@/lib/swr'

export interface DynamicChartProps {
  chartName: string
  chartProps?: Record<string, unknown>
}

export const DynamicChart = function DynamicChart({
  chartName,
  chartProps = {},
}: DynamicChartProps) {
  const hostId = useHostId()
  const ChartComponent = getChartComponent(chartName)

  if (!ChartComponent) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-muted-foreground/20 shadow-none">
        <p className="text-muted-foreground text-sm">
          Unknown chart: {chartName}
        </p>
      </div>
    )
  }

  return (
    <ChartComponent
      className="w-full min-w-0 p-0 shadow-none h-full min-h-[200px]"
      chartClassName="h-full"
      hostId={hostId}
      {...chartProps}
    />
  )
}
