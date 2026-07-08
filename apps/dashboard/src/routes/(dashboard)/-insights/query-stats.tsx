import {
  HardDriveIcon,
  MemoryStickIcon,
  ScrollTextIcon,
  SearchIcon,
} from 'lucide-react'

import { StatCard, statEmpty, statLoading } from './stat-card'
import { useChartData } from '@/lib/query/use-chart-data'

interface RangeStatProps {
  readonly hostId: number
  readonly lastHours?: number
  readonly percentile: string
}

export function TotalQueriesStat({
  hostId,
  lastHours,
  percentile,
}: RangeStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-total-queries',
    hostId,
    lastHours,
    params: { percentile },
  })
  if (isLoading) return statLoading('Total Queries')
  if (error || !data?.length)
    return statEmpty('Total Queries', sql, data, metadata)
  const d = data[0] as { total_queries: number; readable_count: string }
  if (
    d.total_queries === null ||
    d.total_queries === undefined ||
    d.readable_count === null ||
    d.readable_count === undefined
  ) {
    return statEmpty('Total Queries', sql, data, metadata)
  }
  const pLabel = percentile === '100' ? '' : ` (p${percentile})`
  return (
    <StatCard
      title={`Total Queries${pLabel}`}
      icon={<SearchIcon className="size-3.5 text-sky-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_count)}
      subtitle="Completed queries"
    />
  )
}

export function TotalScannedStat({
  hostId,
  lastHours,
  percentile,
}: RangeStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-total-scanned',
    hostId,
    lastHours,
    params: { percentile },
  })
  if (isLoading) return statLoading('Total Data Scanned')
  if (error || !data?.length)
    return statEmpty('Total Data Scanned', sql, data, metadata)
  const d = data[0] as { total_bytes: number; readable_total: string }
  if (
    d.total_bytes === null ||
    d.total_bytes === undefined ||
    d.readable_total === null ||
    d.readable_total === undefined
  ) {
    return statEmpty('Total Data Scanned', sql, data, metadata)
  }
  const pLabel = percentile === '100' ? '' : ` (p${percentile})`
  return (
    <StatCard
      title={`Total Data Scanned${pLabel}`}
      icon={<HardDriveIcon className="size-3.5 text-violet-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_total)}
      subtitle="Read across all queries"
    />
  )
}

export function TotalRowsReadStat({
  hostId,
  lastHours,
  percentile,
}: RangeStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-total-rows-read',
    hostId,
    lastHours,
    params: { percentile },
  })
  if (isLoading) return statLoading('Total Rows Read')
  if (error || !data?.length)
    return statEmpty('Total Rows Read', sql, data, metadata)
  const d = data[0] as { total_rows: number; readable_total: string }
  if (
    d.total_rows === null ||
    d.total_rows === undefined ||
    d.readable_total === null ||
    d.readable_total === undefined
  ) {
    return statEmpty('Total Rows Read', sql, data, metadata)
  }
  const pLabel = percentile === '100' ? '' : ` (p${percentile})`
  return (
    <StatCard
      title={`Total Rows Read${pLabel}`}
      icon={<ScrollTextIcon className="size-3.5 text-blue-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_total)}
      subtitle="Rows scanned by all queries"
    />
  )
}

export function PeakMemoryStat({
  hostId,
  lastHours,
  percentile,
}: RangeStatProps) {
  const { data, isLoading, error, sql, metadata } = useChartData({
    chartName: 'insight-peak-memory',
    hostId,
    lastHours,
    params: { percentile },
  })
  if (isLoading) return statLoading('Peak Memory')
  if (error || !data?.length)
    return statEmpty('Peak Memory', sql, data, metadata)
  const d = data[0] as { peak_memory: number; readable_peak: string }
  if (
    d.peak_memory === null ||
    d.peak_memory === undefined ||
    d.readable_peak === null ||
    d.readable_peak === undefined
  ) {
    return statEmpty('Peak Memory', sql, data, metadata)
  }
  const pLabel = percentile === '100' ? '' : ` (p${percentile})`
  return (
    <StatCard
      title={`Peak Memory${pLabel}`}
      icon={<MemoryStickIcon className="size-3.5 text-pink-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_peak)}
      subtitle="Highest query memory usage"
    />
  )
}
