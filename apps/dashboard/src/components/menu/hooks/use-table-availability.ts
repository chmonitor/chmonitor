/**
 * Table Availability Hooks
 *
 * Fetches backing table availability via SWR with lazy loading and caching.
 *
 * All sidebar items backed by system tables share a single batched request to
 * `/api/v1/table-availability?hostId=<n>` (deduped by SWR via a shared key).
 *
 * Uses a slow refresh interval to minimize API load since table availability
 * rarely changes.
 */

import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { REFRESH_INTERVAL, visibilityAwareInterval } from '@/lib/swr/config'

interface TableAvailabilityResponse {
  success: boolean
  data: { available: Record<string, boolean> }
  error?: { message: string }
}

/**
 * Fetches the full map of table availability for a host in a single request.
 *
 * All callers share the same TanStack Query key (`['/api/v1/table-availability', hostId]`), so
 * the query dedupes all invocations into ONE network request per host.
 *
 * @param hostId - The current host ID
 */
export function useTableAvailability(hostId: number): {
  available: Record<string, boolean>
  isLoading: boolean
  error?: Error
} {
  const { data, error, isLoading } = useQuery<TableAvailabilityResponse>({
    queryKey: ['/api/v1/table-availability', hostId],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/table-availability?hostId=${hostId}`)
      if (!res.ok) {
        throw new Error('Failed to fetch table availability')
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
    available: data?.data?.available ?? {},
    isLoading,
    error: error ?? undefined,
  }
}

/**
 * Resolve one `tableCheck` against the batched availability map.
 *
 * Fail-open by contract: a table is available unless the map EXPLICITLY reports
 * `false`. Callers that also need the loading state must gate their decision on
 * it themselves (see `lib/menu/unavailable-visibility.ts`) so the one-sided
 * fail-open default here is never mistaken for a settled answer.
 *
 * Pure, so a group can resolve all of its children from one map read instead of
 * one hook call per child.
 *
 * @param available - The host's availability map
 * @param tableCheck - The table name or array of table names to check
 */
export function tableCheckAvailable(
  available: Record<string, boolean>,
  tableCheck: string | string[] | undefined
): boolean {
  if (!tableCheck) return true

  const tables = Array.isArray(tableCheck) ? tableCheck : [tableCheck]
  return tables.every((table) => available[table] !== false)
}

/**
 * Selects a single table's availability status by key from the batched map.
 *
 * Backed by {@link useTableAvailability}, so every component reuses the one shared
 * request instead of fetching independently.
 *
 * @param tableCheck - The table name or array of table names to check
 * @param hostId - The current host ID
 */
export function useIsTableAvailable(
  tableCheck: string | string[] | undefined,
  hostId: number
): { available: boolean; isLoading: boolean } {
  const { available, isLoading } = useTableAvailability(hostId)

  if (!tableCheck) {
    return { available: true, isLoading: false }
  }

  return {
    available: tableCheckAvailable(available, tableCheck),
    isLoading,
  }
}
