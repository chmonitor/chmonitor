import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowUpDownIcon,
  BarChart3Icon,
  TimerIcon,
} from 'lucide-react'

import type { Dispatch, SetStateAction } from 'react'

import { StatCard, statEmpty, statLoading } from './stat-card'
import { useGroupedChartData } from '@/lib/query/use-chart-grouping'
import { cn, formatDuration } from '@/lib/utils'

const PERCENTILES = ['95', '99', '100'] as const

export function PercentileSelector({
  value,
  onChange,
}: {
  readonly value: string
  readonly onChange: Dispatch<SetStateAction<string>>
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground font-medium">Percentile</span>
      <div className="flex rounded-lg border bg-muted p-0.5">
        {PERCENTILES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              value === p
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            p{p}
          </button>
        ))}
      </div>
    </div>
  )
}

function formatDay(day: string | Date): string {
  return new Date(day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function BusiestDayQueriesStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-busiest-day-queries',
  })
  if (isLoading) return statLoading('Busiest Day by Queries')
  if (error || !data?.length)
    return statEmpty('Busiest Day by Queries', sql, data, metadata)
  const d = data[0] as { day: string | Date; readable_count: string }
  return (
    <StatCard
      title="Busiest Day by Queries"
      icon={<BarChart3Icon className="size-3.5 text-purple-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_count)}
      subtitle={formatDay(d.day)}
    />
  )
}

export function BusiestDayBytesStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-busiest-day-bytes',
  })
  if (isLoading) return statLoading('Busiest Day by Data Scan')
  if (error || !data?.length)
    return statEmpty('Busiest Day by Data Scan', sql, data, metadata)
  const d = data[0] as {
    day: string | Date
    readable_bytes: string
    query_count: number
  }
  return (
    <StatCard
      title="Busiest Day by Data Scan"
      icon={<ArrowUpDownIcon className="size-3.5 text-orange-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_bytes)}
      subtitle={
        <>
          {formatDay(d.day)} &middot; {d.query_count} queries
        </>
      }
    />
  )
}

export function BusiestSecondStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-busiest-second',
  })
  if (isLoading) return statLoading('Busiest Second by Query Starts')
  if (error || !data?.length)
    return statEmpty('Busiest Second by Query Starts', sql, data, metadata)
  const d = data[0] as { readable_count: string }
  return (
    <StatCard
      title="Busiest Second by Query Starts"
      icon={<ActivityIcon className="size-3.5 text-cyan-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_count)}
    />
  )
}

export function AvgDurationStat({
  percentile,
}: {
  readonly percentile: string
}) {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-avg-duration',
  })
  const label = `Average Query Duration (p${percentile})`
  if (isLoading) return statLoading(label)
  if (error || !data?.length) return statEmpty(label, sql, data, metadata)
  const d = data[0] as { avg_duration_ms: number; query_count: number }
  if (Number.isNaN(Number(d.avg_duration_ms))) {
    return statEmpty(label, sql, data, metadata)
  }
  return (
    <StatCard
      title={label}
      icon={<TimerIcon className="size-3.5 text-indigo-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={formatDuration(Number(d.avg_duration_ms))}
      subtitle={`${d.query_count.toLocaleString()} queries`}
    />
  )
}

export function ErrorRateStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-error-rate',
  })
  if (isLoading) return statLoading('Query Error Rate')
  if (error || !data?.length)
    return statEmpty('Query Error Rate', sql, data, metadata)
  const d = data[0] as {
    error_rate: number
    error_count: number
    total_count: number
  }
  return (
    <StatCard
      title="Query Error Rate"
      icon={<AlertTriangleIcon className="size-3.5 text-rose-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={`${d.error_rate}%`}
      subtitle={
        <>
          {d.error_count} of {d.total_count.toLocaleString()} queries
        </>
      }
    />
  )
}
