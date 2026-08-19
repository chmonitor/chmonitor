'use client'

import { useQuery } from '@tanstack/react-query'

import type { ChartGroupingId } from '@/lib/api/chart-batch'
import type { ChartMetadata, UseChartResult } from '@/lib/query/use-chart-data'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { getChartGrouping } from '@/lib/api/chart-batch'
import {
  fetchChartForHost,
  isCustomHost,
} from '@/lib/host-fetch/resolve-host-fetch'
import { hostConnectionKey } from '@/lib/query/host-query-key'
import {
  chartGroupingQueryKey,
  serializeChartParams,
} from '@/lib/query/query-keys'
import { apiFetch } from '@/lib/swr/api-fetch'
import { chartRefreshInterval } from '@/lib/swr/chart-freshness'
import { REFRESH_INTERVAL } from '@/lib/swr/config'
import { throwIfNotOk } from '@/lib/swr/fetch-error'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

export interface GroupedChartTile {
  data: unknown[]
  metadata?: ChartMetadata
  error?: { type?: string; message: string }
}

interface ChartGroupingContextValue {
  charts: Record<string, GroupedChartTile>
  isLoading: boolean
  isValidating: boolean
  mutate: () => Promise<undefined>
}

const ChartGroupingContext = createContext<ChartGroupingContextValue | null>(
  null
)

interface ChartGroupingProviderProps {
  groupingId: ChartGroupingId
  hostId: number
  lastHours?: number
  params?: Record<string, unknown>
  timezone?: string
  children: ReactNode
}

interface BatchResponse {
  success: boolean
  data: Record<string, GroupedChartTile>
}

export function ChartGroupingProvider({
  groupingId,
  hostId,
  lastHours,
  params,
  timezone,
  children,
}: ChartGroupingProviderProps) {
  const { hosts, getConnectionByHostId } = useMergedHosts()
  const names = getChartGrouping(groupingId) ?? []
  const paramsKey = serializeChartParams(params)
  const browserConnection = hostId < 0 ? getConnectionByHostId(hostId) : null
  const connectionKey = hostConnectionKey(hostId, browserConnection)

  const refreshInterval = names.reduce<number>((min, name) => {
    const next = chartRefreshInterval(name) ?? REFRESH_INTERVAL.DEFAULT_60S
    return Math.min(min, next)
  }, REFRESH_INTERVAL.DEFAULT_60S)

  const { data, error, isPending, isFetching, refetch } = useQuery<
    Record<string, GroupedChartTile>,
    Error
  >({
    queryKey: chartGroupingQueryKey({
      groupingId,
      hostId,
      lastHours,
      paramsKey,
      timezone,
      connectionKey,
    }),
    queryFn: async () => {
      if (isCustomHost(hostId)) {
        const entries = await Promise.all(
          names.map(async (name) => {
            const result = await fetchChartForHost<unknown[]>({
              chartName: name,
              hostId,
              hosts,
              browserConnection,
              lastHours,
              params,
              timezone,
            })
            return [
              name,
              {
                data: Array.isArray(result.data)
                  ? result.data
                  : result.data
                    ? [result.data]
                    : [],
                metadata: result.metadata as ChartMetadata | undefined,
              } satisfies GroupedChartTile,
            ] as const
          })
        )
        return Object.fromEntries(entries)
      }

      const response = await apiFetch('/api/v1/charts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupingId,
          hostId,
          lastHours,
          params,
          timezone,
        }),
      })
      await throwIfNotOk(response, 'Failed to fetch chart grouping')
      const json = (await response.json()) as BatchResponse
      return json.data ?? {}
    },
    staleTime: Math.max(refreshInterval * 0.9, 5_000),
    refetchInterval:
      refreshInterval > 0
        ? () =>
            typeof document !== 'undefined' && document.hidden
              ? false
              : refreshInterval
        : false,
    refetchOnMount: true,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  })

  const value = useMemo<ChartGroupingContextValue>(() => {
    const charts: Record<string, GroupedChartTile> = { ...(data ?? {}) }
    if (error) {
      for (const name of names) {
        const existing = charts[name]
        if (!existing) {
          charts[name] = { data: [], error: { message: error.message } }
        } else if (!existing.error) {
          charts[name] = {
            ...existing,
            error: { message: error.message },
          }
        }
      }
    }
    return {
      charts,
      isLoading: isPending && isFetching,
      isValidating: isFetching,
      mutate: () => refetch().then(() => undefined),
    }
  }, [data, error, isPending, isFetching, refetch, names])

  return (
    <ChartGroupingContext.Provider value={value}>
      {children}
    </ChartGroupingContext.Provider>
  )
}

export function useGroupedChartData<
  T extends Record<string, unknown> = Record<string, unknown>,
>({ chartName }: { chartName: string }): UseChartResult<T> {
  const ctx = useContext(ChartGroupingContext)
  if (!ctx) {
    throw new Error(
      'useGroupedChartData must be used within ChartGroupingProvider'
    )
  }

  const entry = ctx.charts[chartName]
  const dataArray = (entry?.data ?? []) as T[]
  const groupedError = entry?.error
    ? Object.assign(new Error(entry.error.message), {
        type: entry.error.type,
      })
    : undefined

  return {
    data: dataArray,
    metadata: entry?.metadata,
    sql: entry?.metadata?.sql,
    error: groupedError,
    isLoading: ctx.isLoading,
    isValidating: ctx.isValidating,
    mutate: ctx.mutate,
    hasData: dataArray.length > 0,
    staleError: undefined,
    chartName,
  }
}
