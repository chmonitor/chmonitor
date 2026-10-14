import {
  Activity,
  CalendarDays,
  HardDrive,
  Layers,
  type LucideIcon,
  MemoryStick,
  Rows3,
} from 'lucide-react'

import type { MiniBarSeries } from '@/components/charts/mini-charts'
import type { RunningQueryRow } from './running-queries-table'

import { useMemo } from 'react'
import { MiniAreaChart, MiniBarChart } from '@/components/charts/mini-charts'
import {
  formatCompactNumber,
  formatReadableQuantity,
  formatReadableSize,
} from '@/lib/format-readable'
import { useChartData } from '@/lib/query/use-chart-data'
import { useHostId } from '@/lib/swr'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { cn } from '@/lib/utils'

interface CountPoint {
  event_time: string
  query_count: number
  [key: string]: unknown
}
interface MemoryPoint {
  event_time: string
  memory_usage: number
  [key: string]: unknown
}
interface ByUserPoint {
  event_time: string
  user: string
  count: number
  [key: string]: unknown
}
interface TodayPoint {
  count: number
  [key: string]: unknown
}

/** Series color palette for the per-user stacked bars. */
const USER_COLORS = ['#0d9488', '#1e3a5f', '#f59e0b', '#8b5cf6', '#ef4444']

const labelClass =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'

/** A stat card: label + headline value + sub line + area chart. */
function StatCard({
  label,
  value,
  unit,
  sub,
  trend,
  color,
  series,
  valueFormatter,
  compact,
}: {
  label: string
  value: string
  unit?: string
  sub: string
  trend?: { text: string; positive: boolean }
  color: string
  series: number[]
  valueFormatter?: (value: number) => string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card p-3.5',
        compact ? 'min-h-[80px]' : 'min-h-[196px]'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={labelClass}>{label}</span>
        {trend && !compact && (
          <span
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums',
              trend.positive
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
            )}
          >
            {trend.text}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-bold leading-none tracking-tight tabular-nums',
            compact ? 'text-[20px]' : 'text-[26px]'
          )}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[13px] font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {!compact ? (
        <>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {sub}
          </div>
          <div className="mt-auto h-[96px] pt-3">
            <MiniAreaChart
              data={series}
              label={label}
              color={color}
              valueFormatter={valueFormatter}
            />
          </div>
        </>
      ) : sub ? (
        <div className="mt-0.5 text-[10.5px] text-muted-foreground line-clamp-1">
          {sub}
        </div>
      ) : null}
    </div>
  )
}

/** Queries-by-user card: stacked bars + a per-user legend. */
function ByUserCard({
  data,
  series,
  compact,
}: {
  data: Record<string, number>[]
  series: MiniBarSeries[]
  compact?: boolean
}) {
  const activeUsersCount = series.length
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card p-3.5',
        compact ? 'min-h-[80px]' : 'min-h-[196px]'
      )}
    >
      <span className={labelClass}>Queries by user</span>
      {compact ? (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-[20px] font-bold leading-none tracking-tight tabular-nums">
            {activeUsersCount}
          </span>
          <span className="text-[11.5px] font-medium text-muted-foreground">
            active {activeUsersCount === 1 ? 'user' : 'users'}
          </span>
        </div>
      ) : (
        <div className="mt-auto pt-3">
          <div className="h-[96px]">
            <MiniBarChart data={data} series={series} />
          </div>
          {series.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
              {series.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1">
                  <span
                    className="size-2 rounded-sm"
                    style={{ background: s.color }}
                  />
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface SummaryItem {
  icon: LucideIcon
  label: string
  value: string
  unit?: string
}

/** Summary card: an icon-labelled key / value list. */
function SummaryCard({
  items,
  compact,
}: {
  items: SummaryItem[]
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card p-3.5',
        compact ? 'min-h-[80px]' : 'min-h-[196px]'
      )}
    >
      <span className={labelClass}>Summary</span>
      {compact ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
          {items.slice(0, 3).map((item) => (
            <div key={item.label} className="flex items-center gap-1">
              <span className="text-muted-foreground">{item.label}:</span>
              <span className="font-semibold tabular-nums">
                {item.value}
                {item.unit && (
                  <span className="ml-0.5 font-normal text-muted-foreground">
                    {item.unit}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <dl className="mt-2 flex flex-col gap-y-1.5">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-2 text-[12px]"
            >
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <item.icon className="size-3.5 text-muted-foreground/60" />
                {item.label}
              </dt>
              <dd className="font-semibold tabular-nums">
                {item.value}
                {item.unit && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    {item.unit}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Split a "560.6 MiB" string into its number and unit halves. */
function splitSize(readable: string): { value: string; unit: string } {
  const [value, ...rest] = readable.split(' ')
  return { value: value ?? readable, unit: rest.join(' ') }
}

interface RunningQueriesChartsProps {
  /** Live `system.processes` rows — drives the Summary + active-memory card. */
  rows: RunningQueryRow[]
  compact?: boolean
}

/**
 * RunningQueriesCharts — the four-card strip above the Running Queries table.
 *
 * "Running over time" and "Queries by user" come from `system.query_log`
 * (14-day history); "Memory consumed" pairs the live active total with the
 * query-memory trend; "Summary" is aggregated straight from the live rows.
 * Every number is real — there is no synthetic series.
 */
export const RunningQueriesCharts = function RunningQueriesCharts({
  rows,
  compact = false,
}: RunningQueriesChartsProps) {
  const hostId = useHostId()
  const countSwr = useChartData<CountPoint>({
    chartName: 'query-count',
    hostId,
    interval: 'toStartOfDay',
    lastHours: 24 * 14,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })
  const memorySwr = useChartData<MemoryPoint>({
    chartName: 'query-memory',
    hostId,
    interval: 'toStartOfDay',
    lastHours: 24 * 14,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })
  const byUserSwr = useChartData<ByUserPoint>({
    chartName: 'query-count-by-user',
    hostId,
    interval: 'toStartOfDay',
    lastHours: 24 * 14,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })
  const todaySwr = useChartData<TodayPoint>({
    chartName: 'query-count-today',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  // "Running over time" — 14-day query volume + a recent-vs-prior-week trend.
  const running = useMemo(() => {
    const series = (countSwr.data ?? []).map((d) => Number(d.query_count) || 0)
    const total = series.reduce((s, v) => s + v, 0)
    const half = Math.floor(series.length / 2)
    const priorDays = series.slice(0, half)
    const recentDays = series.slice(half)
    const prior = priorDays.reduce((s, v) => s + v, 0)
    const recent = recentDays.reduce((s, v) => s + v, 0)

    // Only show a trend when BOTH halves have a few active days — otherwise
    // a single tiny day in an otherwise zero-filled (WITH FILL) prior window
    // produces an astronomical, meaningless percentage. The result is also
    // clamped so an extreme-but-valid swing stays readable.
    const priorActiveDays = priorDays.filter((v) => v > 0).length
    const recentActiveDays = recentDays.filter((v) => v > 0).length
    const hasComparableHistory =
      priorActiveDays >= 2 && recentActiveDays >= 2 && prior > 0

    const pct = hasComparableHistory
      ? Math.max(-999, Math.min(999, ((recent - prior) / prior) * 100))
      : 0

    return {
      series,
      total: total.toLocaleString(),
      trend: hasComparableHistory
        ? {
            text: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`,
            positive: pct >= 0,
          }
        : undefined,
    }
  }, [countSwr.data])

  // Distributed queries show up in system.processes as an initial row plus
  // secondary fragment rows. Aggregate only the initial rows so memory / row /
  // thread totals are not multiplied by the shard count on a clustered host.
  const initialRows = useMemo(
    () => rows.filter((r) => Number(r.is_initial_query ?? 1) !== 0),
    [rows]
  )

  // "Query memory" — the most recent day's average memory per query. The
  // headline and the sparkline plot the *same* metric, so the number agrees
  // with the chart beneath it. (Live total memory lives in the Summary card.)
  const memory = useMemo(() => {
    const series = (memorySwr.data ?? []).map(
      (d) => Number(d.memory_usage) || 0
    )
    const latest = series.length ? series[series.length - 1] : 0
    return {
      series,
      ...splitSize(formatReadableSize(latest)),
    }
  }, [memorySwr.data])

  // "Queries by user" — pivot the long-form rows into stacked daily bars.
  const byUser = useMemo(() => {
    const points = byUserSwr.data ?? []
    const totals = new Map<string, number>()
    for (const d of points) {
      totals.set(d.user, (totals.get(d.user) ?? 0) + (Number(d.count) || 0))
    }
    const topUsers = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, USER_COLORS.length)
      .map(([user]) => user)
    const series: MiniBarSeries[] = topUsers.map((user, i) => ({
      key: `s${i}`,
      label: user,
      color: USER_COLORS[i],
    }))

    const byTime = new Map<string, Map<string, number>>()
    for (const d of points) {
      const bucket = byTime.get(d.event_time) ?? new Map()
      bucket.set(d.user, (bucket.get(d.user) ?? 0) + (Number(d.count) || 0))
      byTime.set(d.event_time, bucket)
    }
    const data = Array.from(byTime.keys())
      .sort()
      .map((time) => {
        const bucket = byTime.get(time)
        const row: Record<string, number> = {}
        topUsers.forEach((user, i) => {
          row[`s${i}`] = bucket?.get(user) ?? 0
        })
        return row
      })
    return { data, series }
  }, [byUserSwr.data])

  // "Summary" — aggregated from the live rows (initial queries only).
  const summary = useMemo((): SummaryItem[] => {
    const sum = (key: keyof RunningQueryRow) =>
      initialRows.reduce((s, r) => s + (Number(r[key]) || 0), 0)
    const today = Number(todaySwr.data?.[0]?.count ?? 0)
    const memoryTotal = splitSize(formatReadableSize(sum('memory_usage')))
    const dataRead = splitSize(formatReadableSize(sum('read_bytes')))
    return [
      { icon: Activity, label: 'Active', value: String(initialRows.length) },
      {
        icon: MemoryStick,
        label: 'Memory',
        value: memoryTotal.value,
        unit: memoryTotal.unit,
      },
      {
        icon: Rows3,
        label: 'Rows read',
        value: formatReadableQuantity(sum('read_rows')),
      },
      {
        icon: HardDrive,
        label: 'Data read',
        value: dataRead.value,
        unit: dataRead.unit,
      },
      { icon: Layers, label: 'Threads', value: String(sum('thread_count')) },
      { icon: CalendarDays, label: 'Today', value: formatCompactNumber(today) },
    ]
  }, [initialRows, todaySwr.data])

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Running over time"
        value={running.total}
        sub="last 14d total"
        trend={running.trend}
        color="hsl(38 92% 55%)"
        series={running.series}
        valueFormatter={(v) => `${v.toLocaleString()} queries`}
        compact={compact}
      />
      <StatCard
        label="Query memory"
        value={memory.value}
        unit={memory.unit}
        sub="avg per query · last 14d"
        color="#8b5cf6"
        series={memory.series}
        valueFormatter={formatReadableSize}
        compact={compact}
      />
      <ByUserCard data={byUser.data} series={byUser.series} compact={compact} />
      <SummaryCard items={summary} compact={compact} />
    </div>
  )
}
