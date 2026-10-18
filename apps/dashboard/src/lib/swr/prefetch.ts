import type { QueryClient } from '@tanstack/react-query'

import type { PrefetchConfig } from './route-prefetch-map'

import { apiFetch } from './api-fetch'
import { routePrefetchMap } from './route-prefetch-map'
import { hostConnectionKey } from '@/lib/query/host-query-key'
import {
  chartQueryKey,
  serializeChartParams,
  serializeTableSearchParams,
  tableQueryKey,
} from '@/lib/query/query-keys'

/**
 * For prefetching we pass no interval/lastHours/timezone and `params: null`
 * since the default overview charts are fetched without these params.
 * `hostConnectionKey(hostId, null)` matches what the hook computes for an env
 * host (id >= 0) with no browser connection — the only case hover-prefetch
 * currently targets.
 */
function prefetchChart(
  queryClient: QueryClient,
  chartName: string,
  hostId: number
): void {
  const url = `/api/v1/charts/${chartName}?hostId=${hostId}`
  const queryKey = chartQueryKey({
    chartName,
    hostId,
    paramsKey: serializeChartParams(null),
    connectionKey: hostConnectionKey(hostId, null),
  })

  apiFetch(url)
    .then((res) => {
      if (!res.ok) return
      return res.json()
    })
    .then((data) => {
      if (data === undefined) return
      queryClient.setQueryData(queryKey, data)
    })
    .catch(() => {
      // best-effort prefetch
    })
}

function prefetchTable(
  queryClient: QueryClient,
  tableName: string,
  hostId: number
): void {
  const url = `/api/v1/tables/${tableName}?hostId=${hostId}`
  const queryKey = tableQueryKey({
    queryConfigName: tableName,
    hostId,
    searchParamsKey: serializeTableSearchParams({}),
    connectionKey: hostConnectionKey(hostId, null),
  })

  apiFetch(url)
    .then((res) => {
      if (!res.ok) return
      return res.json()
    })
    .then((data) => {
      if (data === undefined) return
      queryClient.setQueryData(queryKey, data)
    })
    .catch(() => {
      // best-effort prefetch
    })
}

/** Dedup guard: tracks in-flight prefetches to avoid flooding on rapid mouse movements */
const inflight = new Set<string>()

export function prefetchRoute(
  queryClient: QueryClient,
  route: string,
  hostId: number
): void {
  const config: PrefetchConfig | undefined = routePrefetchMap[route]
  if (!config) return

  const dedupKey = `${route}:${hostId}`
  if (inflight.has(dedupKey)) return
  inflight.add(dedupKey)

  setTimeout(() => inflight.delete(dedupKey), 5000)

  config.charts?.forEach((name) => prefetchChart(queryClient, name, hostId))
  config.tables?.forEach((name) => prefetchTable(queryClient, name, hostId))
}
