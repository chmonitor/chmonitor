import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'

/**
 * Whether the host has any Replicated* / Shared*MergeTree table (#4044).
 * `undefined` while loading or when the probe fails, so callers keep showing
 * the normal surface instead of claiming replication is unused.
 */
export function useReplicationUsed(hostId: number): boolean | undefined {
  const { data, error } = useChartData<{ used: number | boolean }>({
    chartName: 'replication-usage',
    hostId,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })
  if (error || !data?.length) return undefined
  return Boolean(Number(data[0].used))
}
