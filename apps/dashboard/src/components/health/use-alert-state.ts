/**
 * Data hook for the "Current alert state" card (#2767).
 *
 * Thin TanStack Query wrapper around GET /api/v1/health/alert-state — mirrors
 * the conventions of `use-alert-history.ts`.
 */
import { useQuery } from '@tanstack/react-query'

import type { AlertStateRow } from '@/lib/health/alert-state-persist'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

const REFRESH_INTERVAL_MS = 30_000

interface AlertStateResponse {
  success: boolean
  states: AlertStateRow[]
}

export interface UseAlertStateResult {
  states: AlertStateRow[]
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  refetch: () => void
}

export function useAlertState(hostId?: number): UseAlertStateResult {
  const queryKey = ['/api/v1/health/alert-state', hostId] as const

  const { data, error, isPending, isFetching, refetch } = useQuery<
    AlertStateResponse,
    Error
  >({
    queryKey,
    queryFn: async () => {
      const qs = hostId === undefined ? '' : `?hostId=${hostId}`
      const response = await apiFetch(`/api/v1/health/alert-state${qs}`)
      await throwIfNotOk(response, 'Failed to fetch alert state')
      return response.json() as Promise<AlertStateResponse>
    },
    staleTime: REFRESH_INTERVAL_MS * 0.9,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.hidden
        ? false
        : REFRESH_INTERVAL_MS,
    placeholderData: (prev) => prev,
  })

  return {
    states: data?.states ?? [],
    isLoading: isPending && isFetching,
    isFetching,
    error,
    refetch: () => {
      void refetch()
    },
  }
}
