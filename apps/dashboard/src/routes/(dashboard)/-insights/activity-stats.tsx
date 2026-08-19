import {
  ActivityIcon,
  CombineIcon,
  LayersIcon,
  ListTodoIcon,
  MonitorIcon,
  ServerIcon,
  UnplugIcon,
} from 'lucide-react'

import { StatCard, statEmpty, statLoading } from './stat-card'
import { useGroupedChartData } from '@/lib/query/use-chart-grouping'

export function ActiveQueriesStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-active-queries',
  })
  if (isLoading) return statLoading('Active Queries')
  if (error || !data?.length)
    return statEmpty('Active Queries', sql, data, metadata)
  const d = data[0] as { active_queries: number; readable_count: string }
  return (
    <StatCard
      title="Active Queries"
      icon={<ActivityIcon className="size-3.5 text-green-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_count)}
      subtitle="Currently executing"
    />
  )
}

export function CurrentMemoryStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-current-memory',
  })
  if (isLoading) return statLoading('Current Memory')
  if (error || !data?.length)
    return statEmpty('Current Memory', sql, data, metadata)
  const d = data[0] as { memory_bytes: number; readable_memory: string }
  return (
    <StatCard
      title="Current Memory"
      icon={<MonitorIcon className="size-3.5 text-amber-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_memory)}
      subtitle="MemoryTracking metric"
    />
  )
}

export function HttpConnectionsStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-http-connections',
  })
  if (isLoading) return statLoading('HTTP Connections')
  if (error || !data?.length)
    return statEmpty('HTTP Connections', sql, data, metadata)
  const d = data[0] as { connections: number; readable_connections: string }
  return (
    <StatCard
      title="HTTP Connections"
      icon={<UnplugIcon className="size-3.5 text-orange-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_connections)}
      subtitle="Current HTTP connections"
    />
  )
}

export function ActiveMergesStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-active-merges',
  })
  if (isLoading) return statLoading('Active Merges')
  if (error || !data?.length)
    return statEmpty('Active Merges', sql, data, metadata)
  const d = data[0] as { active_merges: number; readable_count: string }
  return (
    <StatCard
      title="Active Merges"
      icon={<CombineIcon className="size-3.5 text-yellow-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_count)}
      subtitle="Currently merging"
    />
  )
}

export function ActivePartsStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-active-parts',
  })
  if (isLoading) return statLoading('Active Parts')
  if (error || !data?.length)
    return statEmpty('Active Parts', sql, data, metadata)
  const d = data[0] as {
    active_parts: number
    readable_parts: string
    readable_rows: string
  }
  return (
    <StatCard
      title="Active Parts"
      icon={<LayersIcon className="size-3.5 text-indigo-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_parts)}
      subtitle={`${String(d.readable_rows)} rows`}
    />
  )
}

export function DetachedPartsStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-detached-parts',
  })
  if (isLoading) return statLoading('Detached Parts')
  if (error || !data?.length)
    return statEmpty('Detached Parts', sql, data, metadata)
  const d = data[0] as { detached_parts: number; readable_parts: string }
  return (
    <StatCard
      title="Detached Parts"
      icon={<ServerIcon className="size-3.5 text-slate-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_parts)}
      subtitle="Detached data parts"
    />
  )
}

export function ActiveMutationsStat() {
  const { data, isLoading, error, sql, metadata } = useGroupedChartData({
    chartName: 'insight-active-mutations',
  })
  if (isLoading) return statLoading('Active Mutations')
  if (error || !data?.length)
    return statEmpty('Active Mutations', sql, data, metadata)
  const d = data[0] as { active_mutations: number; readable_count: string }
  return (
    <StatCard
      title="Active Mutations"
      icon={<ListTodoIcon className="size-3.5 text-rose-500" />}
      sql={sql}
      data={data}
      metadata={metadata}
      value={String(d.readable_count)}
      subtitle="In-progress mutations"
    />
  )
}
