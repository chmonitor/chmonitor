import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { useId } from 'react'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { formatReadableQuantity } from '@/lib/format-readable'

interface RowsSyncedChartProps {
  data: { time?: string; rows?: number }[]
}

function formatTick(time?: string): string {
  if (!time) return ''
  const t = Date.parse(time)
  if (Number.isNaN(t)) return time
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
  })
}

export function RowsSyncedChart({ data }: RowsSyncedChartProps) {
  const gradientId = useId()
  const config = {
    rows: { label: 'Rows synced', color: 'var(--chart-1, #3b82f6)' },
  } satisfies ChartConfig

  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No sync activity yet.
      </div>
    )
  }

  return (
    <ChartContainer config={config} className="h-[220px] w-full">
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-rows)"
              stopOpacity={0.25}
            />
            <stop offset="100%" stopColor="var(--color-rows)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="time"
          tickFormatter={formatTick}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
          fontSize={11}
        />
        <YAxis
          tickFormatter={(v) => formatReadableQuantity(Number(v))}
          tickLine={false}
          axisLine={false}
          width={48}
          fontSize={11}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                formatTick(payload?.[0]?.payload?.time)
              }
              formatter={(value) => formatReadableQuantity(Number(value))}
            />
          }
        />
        <Area
          dataKey="rows"
          type="monotone"
          stroke="var(--color-rows)"
          strokeWidth={1.8}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
