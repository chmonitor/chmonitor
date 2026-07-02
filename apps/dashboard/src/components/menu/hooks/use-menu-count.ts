/**
 * Menu Count Hooks
 *
 * Fetches menu item counts via TanStack Query with lazy loading and caching.
 *
 * The sidebar renders up to ~18 count badges. Rather than firing one request
 * per badge, all badges share a single batched request to
 * `/api/v1/menu-counts?hostId=<n>` (deduped by TanStack Query via a shared key). Each
 * badge then selects its own value from the returned map.
 *
 * Uses a 2-minute refresh interval to minimize API load while keeping counts
 * fresh.
 */

import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { REFRESH_INTERVAL, visibilityAwareInterval } from '@/lib/swr/config'

interface MenuCountResult {
  count: number | null
  isLoading: boolean
  error?: Error
}

interface MenuCountsResponse {
  success: boolean
  data: { counts: Record<string, number | null> }
  error?: { message: string }
}

/**
 * Fetches the full map of menu counts for a host in a single request.
 *
 * All callers share the same query key (`['/api/v1/menu-counts', hostId]`), so
 * TanStack Query dedupes the N badge invocations into ONE network request per host.
 *
 * Features:
 * - 2-minute refresh interval (non-critical data)
 * - 1-minute stale time to prevent duplicate requests
 * - No revalidation on focus/reconnect (reduces API load)
 * - Silent failure - returns an empty map on error
 *
 * @param hostId - The current host ID
 */
export function useMenuCounts(hostId: number): {
  counts: Record<string, number | null>
  isLoading: boolean
  error?: Error
} {
  const { data, error, isLoading } = useQuery<MenuCountsResponse>({
    queryKey: ['/api/v1/menu-counts', hostId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/menu-counts?hostId=${hostId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch menu counts')
      }
      return res.json()
    },
    refetchInterval: visibilityAwareInterval(REFRESH_INTERVAL.SLOW_2M),
    staleTime: 60_000, // 1 minute deduping
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false, // Don't retry on error (non-critical)
  })

  return {
    counts: data?.data?.counts ?? {},
    isLoading,
    error: error ?? undefined,
  }
}

/**
 * Selects a single menu count by key from the batched counts map.
 *
 * Backed by {@link useMenuCounts}, so every badge reuses the one shared
 * request instead of fetching independently.
 *
 * @param countKey - The count key from menu-count-registry
 * @param hostId - The current host ID
 */
export function useMenuCount(
  countKey: string | undefined,
  hostId: number
): MenuCountResult {
  const { counts, isLoading, error } = useMenuCounts(hostId)

  return {
    count: countKey ? (counts[countKey] ?? null) : null,
    isLoading,
    error,
  }
}
