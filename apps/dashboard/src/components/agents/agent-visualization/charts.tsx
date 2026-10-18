import { Loader2Icon } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts'

import { useMemo } from 'react'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  sanitizeChartConfigKey,
} from '@/components/ui/chart'

export function ChartLoadingSkeleton() {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
    </div>
  )
}

export function EmptyDataMessage() {
  return (
    <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
      No data available
    </div>
  )
}

/** Map y-axis keys to a stable chart-color config (cycles through 5 colors). */
function useSeriesConfig(yKeys: string[]): ChartConfig {
  return useMemo(
    () =>
      Object.fromEntries(
        yKeys.map((key, i) => [
          key,
          { label: key, color: `var(--chart-${(i % 5) + 1})` },
        ])
      ),
    [yKeys]
  )
}

function CategoryXAxis({ xKey }: { xKey: string }) {
  return (
    <XAxis
      dataKey={xKey}
      tick={{ fontSize: 11 }}
      tickLine={false}
      axisLine={false}
      tickFormatter={(v) => {
        const s = String(v)
        return s.length > 12 ? `${s.slice(0, 12)}…` : s
      }}
    />
  )
}

interface BarChartViewProps {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  stacked?: boolean
  logScale?: boolean
}

export function BarChartView({
  data,
  xKey,
  yKeys,
  stacked,
  logScale,
}: BarChartViewProps) {
  const chartConfig = useSeriesConfig(yKeys)

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <CategoryXAxis xKey={xKey} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          scale={logScale ? 'log' : 'auto'}
          domain={logScale ? ['auto', 'auto'] : undefined}
          allowDataOverflow={logScale}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        {yKeys.map((key) => (
          <Bar
            key={key}
            dataKey={key}
            fill={`var(--color-${sanitizeChartConfigKey(key)})`}
            radius={[2, 2, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

interface ComboChartViewProps {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  rightAxisKeys: Set<string>
  logScale?: boolean
}

export function ComboChartView({
  data,
  xKey,
  yKeys,
  rightAxisKeys,
  logScale,
}: ComboChartViewProps) {
  const chartConfig = useSeriesConfig(yKeys)

  const leftKeys = yKeys.filter((k) => !rightAxisKeys.has(k))
  const rightKeys = yKeys.filter((k) => rightAxisKeys.has(k))

  return (
    <ChartContainer config={chartConfig} className="h-48 w-full">
      <ComposedChart
        data={data}
        margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <CategoryXAxis xKey={xKey} />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          scale={logScale ? 'log' : 'auto'}
          domain={logScale ? ['auto', 'auto'] : undefined}
        />
        {rightKeys.length > 0 && (
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
        )}
        <ChartTooltip content={<ChartTooltipContent />} />
        {leftKeys.map((key) => (
          <Bar
            key={key}
            yAxisId="left"
            dataKey={key}
            fill={`var(--color-${sanitizeChartConfigKey(key)})`}
            radius={[2, 2, 0, 0]}
          />
        ))}
        {rightKeys.map((key) => (
          <Line
            key={key}
            yAxisId="right"
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${sanitizeChartConfigKey(key)})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </ComposedChart>
    </ChartContainer>
  )
}
