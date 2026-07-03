import { useQuery } from '@tanstack/react-query'

import type { ApiResponseMetadata } from '@/lib/api/types'
import type { StaleError } from './use-chart-data'

import { useMemo, useRef } from 'react'
import {
  fetchTableForHost,
  isCustomHost,
} from '@/lib/host-fetch/resolve-host-fetch'
import { apiFetch } from '@/lib/swr/api-fetch'
import { throwIfNotOk } from '@/lib/swr/fetch-error'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

interface TableDataResponse<T = unknown> {
  data: T[]
  metadata: ApiResponseMetadata & {
    rows_before_limit_at_least?: number
    exception?: string
  }
}

interface TableQueryParams {
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  page?: number
  limit?: number
  [key: string]: string | number | boolean | undefined
}

export function useTableData<T = unknown>(
  queryConfigName: string,
  hostId?: number,
  searchParams?: TableQueryParams,
  refreshInterval?: number,
  timezone?: string
) {
  const { hosts, getConnectionByHostId } = useMergedHosts()
  const browserConnection =
    hostId !== undefined && hostId < 0 ? getConnectionByHostId(hostId) : null

  // Serialize searchParams so the memo key is value-stable even when a parent
  // recreates the object each render (inline literal / derived state).
  const searchParamsKey = searchParams ? JSON.stringify(searchParams) : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchParams is read inside but keyed via the value-stable searchParamsKey
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (hostId !== undefined) params.append('hostId', String(hostId))
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value))
        }
      })
    }
    if (timezone) params.append('timezone', timezone)

    const queryString = params.toString()
    return `/api/v1/tables/${queryConfigName}${queryString ? `?${queryString}` : ''}`
    // searchParams is read inside but keyed via the stable searchParamsKey.
  }, [queryConfigName, hostId, searchParamsKey, timezone])

  const queryKey = [
    '/api/v1/tables',
    queryConfigName,
    hostId,
    JSON.stringify(searchParams ?? {}),
    timezone,
    hosts.length,
    browserConnection?.id,
  ] as const

  const resolvedRefetchInterval =
    refreshInterval && refreshInterval > 0
      ? () =>
          typeof document !== 'undefined' && document.hidden
            ? false
            : refreshInterval
      : false

  const { data, error, isPending, isFetching, refetch } = useQuery<
    TableDataResponse<T>,
    Error
  >({
    queryKey,
    queryFn: async () => {
      if (isCustomHost(hostId)) {
        const result = await fetchTableForHost<T>({
          queryConfigName,
          hostId,
          hosts,
          browserConnection,
          searchParams,
          timezone,
        })
        return {
          data: result.data,
          metadata: (result.metadata ??
            {}) as unknown as TableDataResponse<T>['metadata'],
        } satisfies TableDataResponse<T>
      }

      const response = await apiFetch(url)
      await throwIfNotOk(response, 'Failed to fetch table data')
      return response.json() as Promise<TableDataResponse<T>>
    },
    staleTime: Math.max((refreshInterval ?? 0) * 0.9, 5_000),
    refetchInterval: resolvedRefetchInterval,
    refetchOnMount: true,
    refetchOnReconnect: true,
    // Keep previous data visible while re-fetching on host/range changes so the
    // UI never blanks to a skeleton during transitions.
    placeholderData: (prev) => prev,
  })

  const dataArray = data?.data ?? []
  const hasData = dataArray.length > 0
  const isLoading = isPending && isFetching
  const isValidating = isFetching

  const staleErrorTimestampRef = useRef<number>(0)

  const staleError = useMemo<StaleError | undefined>(() => {
    if (!error || !hasData || isLoading) {
      staleErrorTimestampRef.current = 0
      return undefined
    }
    if (staleErrorTimestampRef.current === 0) {
      staleErrorTimestampRef.current = Date.now()
    }
    return {
      ...error,
      name: error.name,
      message: error.message,
      timestamp: staleErrorTimestampRef.current,
      type: (error as Error & { type?: string }).type,
      details: (error as Error & { details?: StaleError['details'] }).details,
    }
  }, [error, hasData, isLoading])

  return {
    data: dataArray,
    metadata: data?.metadata,
    error: error ?? undefined,
    isLoading,
    // `isPending` is true whenever no successful response has loaded yet for
    // the current query key — including the dispatched-but-not-yet-fetching /
    // paused / first-paint window where `isFetching` is false. Consumers use it
    // to keep a skeleton up so the empty-state never flashes before data lands.
    isPending,
    isValidating,
    refresh: () => refetch().then(() => undefined),
    hasData,
    staleError,
  }
}
