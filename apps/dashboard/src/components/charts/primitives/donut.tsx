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
  /**
   * Array of data objects
   */
  data: Record<string, unknown>[]

  /**
   * Key for the category/label field
   */
  index: string

  /**
   * Array of keys for the value fields (typically only one for donut charts)
   */
  categories?: string[]

  /**
   * Single category key (alternative to categories array)
   */
  category?: string

  /**
   * Format hint for readable value display
   * - 'bytes': Format as human-readable bytes (KB, MB, GB, etc.)
   * - 'duration': Format as human-readable duration (ms, s, m, h)
   * - 'number': Format as human-readable number with K, M, B suffixes
   * - 'quantity': Format as human-readable quantity (same as number)
   */
  readable?: 'bytes' | 'duration' | 'number' | 'quantity'

  /**
   * Column name whose values should be formatted according to 'readable'
   */
  readableColumn?: string

  /**
   * Show legend below the chart
   */
  showLegend?: boolean

  /**
   * Show label in the center of the donut
   */
  showLabel?: boolean

  /**
   * Center label text
   */
  centerLabel?: string

  /**
   * Custom colors (CSS variable names)
   */
  colors?: string[]

  /**
   * Custom CSS class name
   */
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

  /**
   * Custom value formatter function
   */
  valueFormatter?: (value: number) => string

  /**
   * Click handler for pie segments
   */
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
  // Determine the value key (categories[0] or category)
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

  // Generate chart config for colors and labels
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

  // Custom value formatter with readable support
  const formatValue = useDonutValueFormatter({
    valueFormatter,
    readable,
    readableColumn,
    data,
    valueKey,
  })

  // Calculate total for center label
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
