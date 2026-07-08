import { useQuery } from '@tanstack/react-query'

import type { ApiResponseMetadata } from '@/lib/api/types'

import { useMemo, useRef } from 'react'
import {
  fetchChartForHost,
  isCustomHost,
} from '@/lib/host-fetch/resolve-host-fetch'
import { hostConnectionKey } from '@/lib/query/host-query-key'
import { apiFetch } from '@/lib/swr/api-fetch'
import { REFRESH_INTERVAL, type RefreshInterval } from '@/lib/swr/config'
import { throwIfNotOk } from '@/lib/swr/fetch-error'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

export interface ChartDataPoint {
  [key: string]: unknown
}

export type ChartMetadata = ApiResponseMetadata

interface ChartDataResponse<T = unknown> {
  data: T[] | Record<string, unknown>
  metadata: ChartMetadata
}

export interface StaleError extends Error {
  timestamp: number
  type?: string
  details?: { missingTables?: readonly string[]; [key: string]: unknown }
}

export interface UseChartResult<TData extends ChartDataPoint = ChartDataPoint> {
  data: TData[]
  metadata?: ChartMetadata
  sql?: string
  error?: Error
  isLoading: boolean
  isValidating: boolean
  mutate: () => Promise<undefined | unknown>
  hasData: boolean
  staleError?: StaleError
  chartName: string
}

export interface UseChartDataParams {
  chartName: string
  hostId?: number | string
  interval?: string
  lastHours?: number
  params?: Record<string, unknown>
  timezone?: string
  refreshInterval?: RefreshInterval | number
}

export function useChartData<T extends ChartDataPoint = ChartDataPoint>({
  chartName,
  hostId,
  interval,
  lastHours,
  params,
  timezone,
  refreshInterval = REFRESH_INTERVAL.DEFAULT_60S,
}: UseChartDataParams): UseChartResult<T> {
  const { hosts, getConnectionByHostId } = useMergedHosts()
  const numericHostId =
    hostId === undefined
      ? undefined
      : typeof hostId === 'string'
        ? Number(hostId)
        : hostId
  const browserConnection =
    numericHostId !== undefined && numericHostId < 0
      ? getConnectionByHostId(numericHostId)
      : null

  // Serialize params so the memo key is value-stable: a parent passing an
  // inline `params` object literal changes its reference every render, which
  // would otherwise defeat this memo (re-running on every render).
  const paramsKey = params ? JSON.stringify(params) : ''
  const url = useMemo(() => {
    const searchParams = new URLSearchParams()
    if (hostId !== undefined) searchParams.append('hostId', String(hostId))
    if (interval) searchParams.append('interval', interval)
    if (lastHours !== undefined)
      searchParams.append('lastHours', String(lastHours))
    if (paramsKey) searchParams.append('params', paramsKey)
    if (timezone) searchParams.append('timezone', timezone)

    const queryString = searchParams.toString()
    return `/api/v1/charts/${chartName}${queryString ? `?${queryString}` : ''}`
  }, [chartName, hostId, interval, lastHours, paramsKey, timezone])

  const queryKey = [
    '/api/v1/charts',
    chartName,
    hostId,
    interval,
    lastHours,
    JSON.stringify(params ?? null),
    timezone,
    hostConnectionKey(numericHostId, browserConnection),
  ] as const

  const resolvedRefetchInterval =
    refreshInterval > 0
      ? () =>
          typeof document !== 'undefined' && document.hidden
            ? false
            : (refreshInterval as number)
      : false

  const { data, error, isPending, isFetching, refetch } = useQuery<
    ChartDataResponse<T>,
    Error
  >({
    queryKey,
    queryFn: async () => {
      if (isCustomHost(numericHostId)) {
        const result = await fetchChartForHost<T[]>({
          chartName,
          hostId: numericHostId,
          hosts,
          browserConnection,
          interval,
          lastHours,
          params,
          timezone,
        })
        return {
          data: result.data as ChartDataResponse<T>['data'],
          metadata: (result.metadata ?? {}) as unknown as ChartMetadata,
        } satisfies ChartDataResponse<T>
      }

      const response = await apiFetch(url)
      await throwIfNotOk(response, 'Failed to fetch chart data')
      return response.json() as Promise<ChartDataResponse<T>>
    },
    staleTime: Math.max((refreshInterval as number) * 0.9, 5_000),
    refetchInterval: resolvedRefetchInterval,
    refetchOnMount: true,
    refetchOnReconnect: true,
    // Keep previous data visible while re-fetching on host/range changes so the
    // UI never blanks to a skeleton during transitions.
    placeholderData: (prev) => prev,
    retry: (failureCount, err) => {
      if (
        'status' in err &&
        typeof (err as { status?: number }).status === 'number'
      ) {
        const status = (err as { status: number }).status
        if (status >= 400 && status < 500 && status !== 429) return false
      }
      return failureCount < 3
    },
    retryDelay: (attemptIndex) => Math.min(30_000, 1_000 * 2 ** attemptIndex),
  })

  const dataArray =
    Array.isArray(data?.data) || !data?.data
      ? (data?.data as T[])
      : ([data.data] as T[])

  const hasData = Boolean(dataArray && dataArray.length > 0)
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

  // Prefer successful-response metadata; fall back to SQL attached on the
  // thrown FetchError so empty/error cards can still open "review query".
  const errorSql =
    error && 'sql' in error && typeof error.sql === 'string'
      ? error.sql
      : undefined
  const errorMetadata =
    error && 'metadata' in error && error.metadata
      ? (error.metadata as ChartMetadata)
      : undefined

  return {
    data: dataArray ?? [],
    metadata: data?.metadata ?? errorMetadata,
    sql: data?.metadata?.sql ?? errorSql,
    error: error ?? undefined,
    isLoading,
    isValidating,
    mutate: () => refetch().then(() => undefined),
    hasData,
    staleError,
    chartName,
  }
}
