import type { QueryClient } from '@tanstack/react-query'

import type { PrefetchConfig } from './route-prefetch-map'

import { apiFetch } from './api-fetch'
import { routePrefetchMap } from './route-prefetch-map'
import { hostConnectionKey } from '@/lib/query/host-query-key'
import { chartQueryKey, tableQueryKey } from '@/lib/query/query-keys'

/**
 * Prefetch chart data and seed the TanStack Query cache.
 * Builds the cache key via `chartQueryKey` — the same factory `useChartData`
 * uses — so the seeded entry is actually read on navigation instead of
 * silently orphaning under a different key (issue #2489).
 *
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
    params: null,
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
      // Silently ignore prefetch failures — they're best-effort
    })
}

/**
 * Prefetch table data and seed the TanStack Query cache.
 * Builds the cache key via `tableQueryKey` — the same factory `useTableData`
 * uses — so the seeded entry is actually read on navigation instead of
 * silently orphaning under a different key (issue #2489).
 */
function prefetchTable(
  queryClient: QueryClient,
  tableName: string,
  hostId: number
): void {
  const url = `/api/v1/tables/${tableName}?hostId=${hostId}`
  const queryKey = tableQueryKey({
    queryConfigName: tableName,
    hostId,
    searchParams: {},
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
      // Silently ignore prefetch failures — they're best-effort
    })
}

/** Dedup guard: tracks in-flight prefetches to avoid flooding on rapid mouse movements */
const inflight = new Set<string>()

/**
 * Prefetch all data for a route by pre-populating the TanStack Query cache.
 * Called on nav link hover via requestIdleCallback to avoid blocking interaction.
 *
 * No-ops if the route has no prefetch config or a prefetch for the same
 * route+host is already in flight.
 */
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

  // Clear dedup key after 5s (matches the global dedupingInterval / staleTime)
  setTimeout(() => inflight.delete(dedupKey), 5000)

  config.charts?.forEach((name) => prefetchChart(queryClient, name, hostId))
  config.tables?.forEach((name) => prefetchTable(queryClient, name, hostId))
}
