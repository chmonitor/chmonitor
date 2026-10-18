import { Cell, Label, Pie, PieChart } from 'recharts'

import { DonutChartLabel } from './donut-chart-label'
import { useDonutValueFormatter } from './use-donut-value-formatter'
import { seriesColorVar } from '@/components/charts/primitives/series-color'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

export interface DonutChartProps {
  data: Record<string, unknown>[]

  index: string

  categories?: string[]

  category?: string

  /**
   * Format hint for readable value display
   * - 'bytes': Format as human-readable bytes (KB, MB, GB, etc.)
   * - 'duration': Format as human-readable duration (ms, s, m, h)
   * - 'number': Format as human-readable number with K, M, B suffixes
   * - 'quantity': Format as human-readable quantity (same as number)
   */
  readable?: 'bytes' | 'duration' | 'number' | 'quantity'

  readableColumn?: string

  showLegend?: boolean

  showLabel?: boolean

  centerLabel?: string

  colors?: string[]

  className?: string

  /**
   * Inner radius percentage (0-100)
   * @default 50
   */
  innerRadius?: number

  /**
   * Outer radius percentage (0-100)
   * @default 80
   */
  outerRadius?: number

  valueFormatter?: (value: number) => string

  onClick?: (data: unknown) => void
}

export const DonutChart = function DonutChart({
  data,
  index,
  categories,
  category,
  readable,
  readableColumn,
  showLegend = false,
  showLabel = false,
  centerLabel,
  colors,
  className,
  innerRadius = 50,
  outerRadius = 80,
  valueFormatter,
  onClick,
}: DonutChartProps) {
  const valueKey = (() => {
    if (categories && categories.length > 0) return categories[0]
    if (category) return category
    return 'value'
  })()

  // Transform data for Recharts PieChart
  const chartData = (() => {
    return data.map((row) => ({
      name: String(row[index]),
      value: Number(row[valueKey]) || 0,
      originalData: row,
    }))
  })()

  const chartConfig = (() => {
    const config: ChartConfig = {}
    data.forEach((row, i) => {
      const categoryName = String(row[index])
      config[categoryName] = {
        label: categoryName,
        color: seriesColorVar(i, colors),
      }
    })
    return config
  })()

  const formatValue = useDonutValueFormatter({
    valueFormatter,
    readable,
    readableColumn,
    data,
    valueKey,
  })

  const total = (() => {
    return chartData.reduce((sum, item) => sum + item.value, 0)
  })()

  return (
    <ChartContainer
      config={chartConfig}
      className={cn('mx-auto aspect-square max-h-[300px] min-w-0', className)}
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              nameKey="name"
              formatter={(value) => formatValue(Number(value))}
            />
          }
        />

        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          innerRadius={`${innerRadius}%`}
          outerRadius={`${outerRadius}%`}
          strokeWidth={2}
          onClick={
            onClick
              ? (data) =>
                  onClick(
                    ((data as { originalData?: unknown }).originalData ??
                      data.payload) as unknown
                  )
              : undefined
          }
        >
          {chartData.map((_entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={seriesColorVar(index, colors)}
              className="stroke-background hover:opacity-80 transition-opacity"
            />
          ))}

          {showLabel && (
            <Label
              content={(viewBox) => (
                <DonutChartLabel
                  viewBox={viewBox}
                  total={total}
                  centerLabel={centerLabel}
                  formatValue={formatValue}
                />
              )}
            />
          )}
        </Pie>

        {showLegend && (
          <ChartLegend
            content={<ChartLegendContent nameKey="name" />}
            className="-translate-y-2 flex-wrap gap-2 [&>*]:basis-1/4 [&>*]:justify-center"
          />
        )}
      </PieChart>
    </ChartContainer>
  )
}
