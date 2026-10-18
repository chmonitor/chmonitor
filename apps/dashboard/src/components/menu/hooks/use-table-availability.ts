/** All sidebar items share one batched request (deduped via a shared key). */

import { useQuery } from '@tanstack/react-query'

import { apiFetch } from '@/lib/swr/api-fetch'
import { REFRESH_INTERVAL, visibilityAwareInterval } from '@/lib/swr/config'

interface TableAvailabilityResponse {
  success: boolean
  data: { available: Record<string, boolean> }
  error?: { message: string }
}

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
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })

  return {
    available: data?.data?.available ?? {},
    isLoading,
    error: error ?? undefined,
  }
}

/**
 * Fail-open: available unless the map EXPLICITLY reports `false`. Callers must
 * gate on the loading state themselves so this default is never mistaken for a
 * settled answer.
 */
export function tableCheckAvailable(
  available: Record<string, boolean>,
  tableCheck: string | string[] | undefined
): boolean {
  if (!tableCheck) return true

  const tables = Array.isArray(tableCheck) ? tableCheck : [tableCheck]
  return tables.every((table) => available[table] !== false)
}

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
