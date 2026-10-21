import { LabelList, RadialBar, RadialBarChart } from 'recharts'

import type { RadialChartProps } from '@/types/charts'

import { useMemo } from 'react'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

export const RadialChart = function RadialChart({
  data,
  nameKey,
  dataKey,
  showLegend = false,
  showLabel = false,
  colors,
  colorLabel,
  onClick,
  className,
}: RadialChartProps) {
  const chartConfig = useMemo(() => {
    return data
      .map((row) => row[nameKey])
      .reduce(
        (acc, category, index) => {
          acc[category] = {
            label: category,
            color: colors
              ? `var(${colors[index]})`
              : `var(--chart-${index + 1})`,
          }

          return acc
        },
        {
          label: {
            color: colorLabel ? `var(${colorLabel})` : 'var(--background)',
          },
        } as ChartConfig
      )
  }, [data, nameKey, colors, colorLabel])

  const handleClick = onClick
    ? (
        item: unknown,
        index: number,
        event: React.MouseEvent<SVGGraphicsElement>
      ) => {
        onClick(item, index, event)
      }
    : undefined

  return (
    <ChartContainer
      config={chartConfig}
      className={cn('mx-auto aspect-square max-h-[250px] min-w-0', className)}
    >
      <RadialBarChart
        accessibilityLayer
        data={data}
        innerRadius={30}
        outerRadius={110}
        barSize={25}
      >
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel nameKey={nameKey} />}
        />

        <RadialBar dataKey={dataKey} onClick={handleClick} background>
          {showLabel && (
            <LabelList
              position="insideStart"
              dataKey={dataKey}
              className="fill-white capitalize mix-blend-luminosity"
              fontSize={11}
            />
          )}
        </RadialBar>

        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
      </RadialBarChart>
    </ChartContainer>
  )
}
