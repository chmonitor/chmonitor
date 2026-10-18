import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from './api-fetch'
import {
  NON_CRITICAL_RETRY,
  REFRESH_INTERVAL,
  visibilityAwareInterval,
} from '@/lib/swr/config'

interface ClusterCountResult {
  count: number | null
  isLoading: boolean
  error?: Error
  refresh: () => void
}

interface ClusterCountResponse {
  success: boolean
  data: { count: number | null }
  error?: { message: string }
}

export function useClusterCount(
  countKey: string | undefined,
  hostId: number,
  cluster: string | undefined
): ClusterCountResult {
  const queryClient = useQueryClient()
  const queryKey = [`/api/v1/cluster-counts`, countKey, hostId, cluster]

  const { data, error, isLoading } = useQuery<ClusterCountResponse>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(
        `/api/v1/cluster-counts/${countKey}?hostId=${hostId}&cluster=${encodeURIComponent(cluster!)}`
      )
      if (!res.ok) {
        throw new Error('Failed to fetch cluster count')
      }
      return res.json()
    },
    enabled: Boolean(countKey && cluster),
    refetchInterval: visibilityAwareInterval(REFRESH_INTERVAL.MEDIUM_30S),
    staleTime: 15_000, // 15 seconds deduping
    refetchOnWindowFocus: true, // Revalidate on focus for critical metrics
    refetchOnReconnect: true, // Revalidate on reconnect
    // Non-critical always-on poll: cap retries to avoid amplifying a transient
    // blip into extra Worker→ClickHouse round-trips (next poll recovers).
    retry: NON_CRITICAL_RETRY,
  })

  return {
    count: data?.data?.count ?? null,
    isLoading,
    error: error ?? undefined,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  }
}
