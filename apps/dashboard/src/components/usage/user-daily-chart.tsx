import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import type { HeatmapDayRow } from '@/components/charts/query/query-count-calendar/metrics'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer as ChartStateContainer } from '@/components/charts/chart-container'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { USER_DAILY_MAX_DAYS } from '@/lib/query-config/queries/user-usage'
import { useChartData, useHostId } from '@/lib/swr'

export type UserDailyPoint = {
  day: string
  queries: number
  failed: number
}

const toIso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * One point per day for the last `days` days ending `today` (UTC dates, like
 * the calendar rows); a day with no row is zero so gaps read as idle days.
 */
export function buildUserDailySeries(
  rows: HeatmapDayRow[],
  days: number,
  today: Date
): UserDailyPoint[] {
  const byDay = new Map(rows.map((r) => [String(r.date).slice(0, 10), r]))
  const end = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  )
  return Array.from({ length: days }, (_, i) => {
    const day = toIso(new Date(end - (days - 1 - i) * 86_400_000))
    const row = byDay.get(day)
    return {
      day,
      queries: Number(row?.query_count ?? 0),
      failed: Number(row?.failed_count ?? 0),
    }
  })
}

const chartConfig = {
  queries: { label: 'Queries', color: 'var(--chart-1)' },
  failed: { label: 'Failed', color: 'var(--destructive)' },
} satisfies ChartConfig

/**
 * Daily queries (bars) and failures (line) for one user over the page window.
 * Reads the same per-user calendar series as the Activity Calendar, so the two
 * share one request.
 */
export function UserDailyChart({ user, days }: { user: string; days: number }) {
  const hostId = useHostId()
  const swr = useChartData({
    chartName: 'query-count-heatmap',
    hostId,
    lastHours: 24 * USER_DAILY_MAX_DAYS,
    params: { user },
  })
  const title = 'Daily Queries'

  return (
    <ChartStateContainer swr={swr} title={title}>
      {(dataArray, sql, metadata) => {
        const series = buildUserDailySeries(
          dataArray as unknown as HeatmapDayRow[],
          days,
          new Date()
        )
        return (
          <ChartCard
            title={title}
            sql={sql}
            data={series}
            metadata={metadata}
            data-testid="user-daily-chart"
          >
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-56 w-full sm:h-64"
            >
              <ComposedChart data={series} margin={{ left: 0, right: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis
                  yAxisId="left"
                  width={40}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={32}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  yAxisId="left"
                  dataKey="queries"
                  fill="var(--color-queries)"
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="failed"
                  stroke="var(--color-failed)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ChartContainer>
          </ChartCard>
        )
      }}
    </ChartStateContainer>
  )
}
