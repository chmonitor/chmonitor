import { Area, AreaChart, Bar, BarChart } from 'recharts'

import { useId } from 'react'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

/**
 * Compact, axis-less chart components for KPI cards and chart strips.
 *
 * These follow the shadcn chart strategy — they wrap Recharts in
 * {@link ChartContainer} so they inherit the theme-aware `--color-*` tokens
 * and the {@link ChartTooltip} system, rather than hand-rolling SVG. Use them
 * for small in-card charts where the full {@link AreaChart} / {@link BarChart}
 * primitives (axes, legend, 200px height) would be too heavy.
 */

const EMPTY_CLASS =
  'flex size-full items-center justify-center text-[10px] text-muted-foreground'

// ───────────────────────── area ─────────────────────────

export interface MiniAreaChartProps {
  /** Ordered values, oldest first. Needs ≥ 2 points to draw. */
  data: number[]
  /** Series label shown in the tooltip. */
  label: string
  /** Stroke / fill color (any CSS color). */
  color: string
  /** Formats the value shown in the tooltip. */
  valueFormatter?: (value: number) => string
  /** Extra classes for the chart container. */
  className?: string
}

/** A compact, gradient-filled area chart with a value tooltip. */
export const MiniAreaChart = function MiniAreaChart({
  data,
  label,
  color,
  valueFormatter,
  className,
}: MiniAreaChartProps) {
  const gradientId = useId()

  if (data.length < 2) {
    return <div className={EMPTY_CLASS}>No data</div>
  }

  const config = { value: { label, color } } satisfies ChartConfig
  const chartData = data.map((value, index) => ({ index, value }))

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto size-full', className)}
    >
      <AreaChart
        data={chartData}
        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        accessibilityLayer={false}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value) =>
                valueFormatter
                  ? valueFormatter(Number(value))
                  : Number(value).toLocaleString()
              }
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          stroke={color}
          strokeWidth={1.6}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

// ───────────────────────── stacked bar ─────────────────────────

export interface MiniBarSeries {
  /** Stable key — also the data-row key. */
  key: string
  /** Human label shown in the tooltip. */
  label: string
  /** Bar color (any CSS color). */
  color: string
}

export interface MiniBarChartProps {
  /** One row per bucket, each keyed by every series' `key`. */
  data: Record<string, number>[]
  /** Series in stacking order (bottom → top). */
  series: MiniBarSeries[]
  /** Extra classes for the chart container. */
  className?: string
}

/** A compact stacked bar chart with a per-series tooltip. */
export const MiniBarChart = function MiniBarChart({
  data,
  series,
  className,
}: MiniBarChartProps) {
  if (data.length === 0 || series.length === 0) {
    return <div className={EMPTY_CLASS}>No data</div>
  }

  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }])
  ) satisfies ChartConfig

  return (
    <ChartContainer
      config={config}
      className={cn('aspect-auto size-full', className)}
    >
      <BarChart
        data={data}
        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
        barCategoryGap={2}
        accessibilityLayer={false}
      >
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          content={<ChartTooltipContent hideLabel indicator="dot" />}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="series"
            fill={s.color}
            isAnimationActive={false}
            radius={i === series.length - 1 ? [2, 2, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
