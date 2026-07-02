/**
 * Cluster Count Hook
 *
 * Fetches cluster-level counts via SWR with appropriate caching.
 * Uses a 30-second refresh interval for critical operational metrics.
 *
 * Unlike menu counts (2-minute refresh), cluster counts are more critical
 * as they indicate potential issues like readonly tables or replication lag.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from './api-fetch'
import { REFRESH_INTERVAL, visibilityAwareInterval } from '@/lib/swr/config'

interface ClusterCountResult {
  count: number | null
  isLoading: boolean
  error?: Error
  /** Mutate function to manually refresh the data */
  refresh: () => void
}

interface ClusterCountResponse {
  success: boolean
  data: { count: number | null }
  error?: { message: string }
}

/**
 * Fetches a cluster count by key for a specific cluster.
 *
 * Features:
 * - 30-second refresh interval (critical operational data)
 * - 15-second deduping to prevent duplicate requests
 * - Revalidates on focus (critical metrics should be fresh)
 * - Returns null on error to prevent UI disruption
 *
 * @param countKey - The count key from cluster-count-registry
 * @param hostId - The current host ID
 * @param cluster - The cluster name (required)
 */
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
    retry: 2, // Retry on error for critical data, limit retries
  })

  return {
    count: data?.data?.count ?? null,
    isLoading,
    error: error ?? undefined,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  }
}
