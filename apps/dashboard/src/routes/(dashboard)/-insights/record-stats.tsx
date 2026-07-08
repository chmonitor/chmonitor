import { ClockIcon, DatabaseIcon, HardDriveIcon, ZapIcon } from 'lucide-react'

import { StatCard, statEmpty, statLoading } from './stat-card'
import { useChartData } from '@/lib/query/use-chart-data'
import { formatDuration } from '@/lib/utils'

interface RangeStatProps {
  readonly hostId: number
  readonly lastHours?: number
}

interface PercentileStatProps extends RangeStatProps {
  readonly percentile: string
}

export function LargestScanStat({
  hostId,
  lastHours,
  percentile,
}: PercentileStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-largest-scan',
    hostId,
    lastHours,
    params: { percentile },
  })
  const label = `Largest Scan (p${percentile})`
  if (isLoading) return statLoading(label)
  if (error || !data?.length) return statEmpty(label, sql, data, metadata)
  const d = data[0] as Record<string, unknown>
  const readable = d.readable_bytes
  const bytes = d.read_bytes
  if (
    bytes === null ||
    bytes === undefined ||
    Number.isNaN(Number(bytes)) ||
    readable === null ||
    readable === undefined ||
    String(readable).toLowerCase() === 'nan'
  ) {
    return statEmpty(label, sql, data, metadata)
  }
  return (
    <StatCard
      title={label}
      icon={<HardDriveIcon className="size-3.5 text-blue-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(readable)}
    />
  )
}

export function FastestScanStat({
  hostId,
  lastHours,
  percentile,
}: PercentileStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-fastest-scan',
    hostId,
    lastHours,
    params: { percentile },
  })
  const label = `Fastest Scan Speed (p${percentile})`
  if (isLoading) return statLoading(label)
  if (error || !data?.length) return statEmpty(label, sql, data, metadata)
  const d = data[0] as Record<string, unknown>
  if (
    d.bytes_per_second === null ||
    d.bytes_per_second === undefined ||
    d.readable_speed === null ||
    d.readable_speed === undefined ||
    d.readable_speed === 'NaN'
  ) {
    return statEmpty(label, sql, data, metadata)
  }
  return (
    <StatCard
      title={label}
      icon={<ZapIcon className="size-3.5 text-yellow-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={`${String(d.readable_speed)}/s`}
    />
  )
}

export function LongestQueryStat({
  hostId,
  lastHours,
  percentile,
}: PercentileStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-longest-query',
    hostId,
    lastHours,
    params: { percentile },
  })
  const label = `Longest Query (p${percentile})`
  if (isLoading) return statLoading(label)
  if (error || !data?.length) return statEmpty(label, sql, data, metadata)
  const d = data[0] as Record<string, unknown>
  if (
    d.query_duration_ms === null ||
    d.query_duration_ms === undefined ||
    Number.isNaN(Number(d.query_duration_ms))
  ) {
    return statEmpty(label, sql, data, metadata)
  }
  return (
    <StatCard
      title={label}
      icon={<ClockIcon className="size-3.5 text-red-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={formatDuration(Number(d.query_duration_ms))}
    />
  )
}

export function TotalStorageStat({ hostId }: { readonly hostId: number }) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-total-storage',
    hostId,
  })
  if (isLoading) return statLoading('Total Storage')
  if (error || !data?.length)
    return statEmpty('Total Storage', sql, data, metadata)
  const d = data[0] as Record<string, unknown>
  if (
    d.total_compressed === null ||
    d.total_compressed === undefined ||
    d.total_tables === null ||
    d.total_tables === undefined
  ) {
    return statEmpty('Total Storage', sql, data, metadata)
  }
  return (
    <StatCard
      title="Total Storage"
      icon={<DatabaseIcon className="size-3.5 text-emerald-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.total_compressed)}
      subtitle={
        <>
          {String(d.total_tables)} tables, {String(d.readable_rows)} rows
        </>
      }
    />
  )
}
