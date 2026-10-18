/**
 * Batched data hook for the /health page.
 *
 *
 *  - Standard env hosts hit the batched `/api/v1/health/checks` endpoint, so
 *    all checks resolve in one HTTP round-trip.
 *  - Custom / browser / database-backed hosts (negative or non-env hostIds)
 *    can't be reached server-side, so they fall back to per-chart client fetches
 *    run in parallel — still surfaced through the same single query, so cards
 *    share one cache entry and one loading state.
 *
 * Because it is one query, returning to /health renders last-known cached values
 * instantly (TanStack Query gcTime + persisted cache) instead of a loading flash,
 * while a background refetch updates them.
 */
import { useQuery } from '@tanstack/react-query'

import type { DataStatus } from '@/lib/api/types'
import type { ChartDataPoint } from '@/lib/swr'

import { useMemo } from 'react'
import {
  fetchChartForHost,
  isCustomHost,
} from '@/lib/host-fetch/resolve-host-fetch'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

const REFRESH_INTERVAL_MS = 30_000

export interface HealthCheckState {
  data: ChartDataPoint[]
  status?: DataStatus
  statusMessage?: string
  clickhouseVersion?: string
  error?: { type: string; message: string }
}

interface BatchResponse {
  success: boolean
  checks: Record<string, HealthCheckState>
}

export interface UseHealthChecksResult {
  /** Resolved state per chart name. Empty until the first fetch lands. */
  results: Record<string, HealthCheckState>
  isLoading: boolean
  isValidating: boolean
  /** Unix-ms timestamp of the last successful fetch (0 until first load). */
  dataUpdatedAt: number
}

const EMPTY_STATE: HealthCheckState = { data: [] }

/**
 * Fetch every requested health check in a single query.
 *
 */
export function useHealthChecks(
  chartNames: readonly string[],
  hostId: number,
  timezone?: string
): UseHealthChecksResult {
  const { hosts, getConnectionByHostId } = useMergedHosts()

  // Stable, order-independent key for the requested checks. Sorting ~12 names
  // each render is negligible and keeps the query key deterministic.
  const sortedNames = [...chartNames].sort()

  const browserConnection = isCustomHost(hostId)
    ? getConnectionByHostId(hostId)
    : null

  const queryKey = [
    '/api/v1/health/checks',
    hostId,
    sortedNames.join(','),
    timezone,
    hosts.length,
    browserConnection?.id,
  ] as const

  const useBatchedEndpoint = !isCustomHost(hostId)

  const { data, error, isPending, isFetching, dataUpdatedAt } = useQuery<
    BatchResponse,
    Error
  >({
    queryKey,
    queryFn: async () => {
      if (useBatchedEndpoint) {
        const params = new URLSearchParams()
        params.set('hostId', String(hostId))
        params.set('charts', sortedNames.join(','))
        if (timezone) params.set('timezone', timezone)
        const response = await apiFetch(`/api/v1/health/checks?${params}`)
        await throwIfNotOk(response, 'Failed to fetch health checks')
        return response.json() as Promise<BatchResponse>
      }

      // Custom / db / browser hosts: fan out client-side, one fetch per check,
      // collapsing per-check failures into the same response shape.
      const entries = await Promise.all(
        sortedNames.map(async (name): Promise<[string, HealthCheckState]> => {
          try {
            const result = await fetchChartForHost<ChartDataPoint[]>({
              chartName: name,
              hostId,
              hosts,
              browserConnection,
              timezone,
            })
            const meta = result.metadata as
              | { status?: DataStatus; statusMessage?: string }
              | undefined
            return [
              name,
              {
                data: Array.isArray(result.data) ? result.data : [],
                status: meta?.status,
                statusMessage: meta?.statusMessage,
              },
            ]
          } catch (err) {
            return [
              name,
              {
                data: [],
                error: {
                  type: 'query_error',
                  message: err instanceof Error ? err.message : 'Unknown error',
                },
              },
            ]
          }
        })
      )
      const checks: Record<string, HealthCheckState> = {}
      for (const [name, state] of entries) checks[name] = state
      return { success: true, checks }
    },
    staleTime: REFRESH_INTERVAL_MS * 0.9,
    refetchInterval: () =>
      typeof document !== 'undefined' && document.hidden
        ? false
        : REFRESH_INTERVAL_MS,
    refetchOnMount: true,
    refetchOnReconnect: true,
    // Keep prior data visible while refetching so revisits don't blank to a
    // loading state.
    placeholderData: (prev) => prev,
  })

  // Pending only when there is no cached data at all — once cache exists we show
  // stale values instead of the loading label.
  const isLoading = isPending && isFetching

  // A top-level fetch failure with no cached data: surface it as a per-check
  // error so every card shows "Unavailable" instead of a misleading "OK / 0".
  const results = useMemo<Record<string, HealthCheckState>>(() => {
    if (data?.checks) return data.checks
    if (error && !isLoading) {
      const errored: Record<string, HealthCheckState> = {}
      for (const name of sortedNames) {
        errored[name] = {
          data: [],
          error: { type: 'query_error', message: error.message },
        }
      }
      return errored
    }
    return {}
  }, [data, error, isLoading, sortedNames])

  return { results, isLoading, isValidating: isFetching, dataUpdatedAt }
}

export { EMPTY_STATE }
