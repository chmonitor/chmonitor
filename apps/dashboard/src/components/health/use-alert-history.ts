/**
 * Data hook for the "Recent alerts" card (health-settings-panel.tsx).
 *
 * Thin TanStack Query wrapper around GET /api/v1/health/history — mirrors the
 * fetch/error conventions of `use-health-checks.ts` (apiFetch + throwIfNotOk)
 * but for a single, simple query instead of a batch.
 */
import { useQuery } from '@tanstack/react-query'

import type { AlertEventRecord } from '@/lib/health/alert-history-store'

import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'

const REFRESH_INTERVAL_MS = 30_000

interface HistoryResponse {
  success: boolean
  events: AlertEventRecord[]
}

export interface UseAlertHistoryParams {
  /** Omit to show alerts across every host. */
  hostId?: number
  /** `YYYY-MM-DD`. Omit to show the most recent alerts regardless of date. */
  day?: string
  limit?: number
}

export interface UseAlertHistoryResult {
  events: AlertEventRecord[]
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  refetch: () => void
}

export function useAlertHistory({
  hostId,
  day,
  limit,
}: UseAlertHistoryParams): UseAlertHistoryResult {
  const queryKey = ['/api/v1/health/history', hostId, day, limit] as const

  const { data, error, isPending, isFetching, refetch } = useQuery<
    HistoryResponse,
    Error
  >({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams()
      if (hostId !== undefined) params.set('hostId', String(hostId))
      if (day) params.set('day', day)
      if (limit !== undefined) params.set('limit', String(limit))
      const qs = params.toString()
      const response = await apiFetch(
        `/api/v1/health/history${qs ? `?${qs}` : ''}`
      )
      await throwIfNotOk(response, 'Failed to fetch alert history')
      return response.json() as Promise<HistoryResponse>
    },
    staleTime: REFRESH_INTERVAL_MS * 0.9,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.hidden
        ? false
        : REFRESH_INTERVAL_MS,
    placeholderData: (prev) => prev,
  })

  return {
    events: data?.events ?? [],
    isLoading: isPending && isFetching,
    isFetching,
    error,
    refetch: () => {
      void refetch()
    },
  }
}
