/**
 * Shared TanStack Query key factories for chart/table data.
 *
 * `useChartData` / `useTableData` (live reads) and `prefetchRoute` (hover
 * prefetch — see `lib/swr/prefetch.ts`) must build byte-identical keys, or
 * TanStack Query hashes them differently and the prefetched cache entry is
 * never hit: the seeded data becomes dead weight and the live hook refetches
 * anyway. Route BOTH key shapes through these factories — never inline a key
 * array at a call site — so a future field addition can't silently break
 * prefetch again.
 */

export interface ChartQueryKeyParams {
  chartName: string
  hostId?: number | string
  interval?: string
  lastHours?: number
  params?: Record<string, unknown> | null
  timezone?: string
  /** Precompute via `hostConnectionKey(numericHostId, browserConnection)`. */
  connectionKey: string | undefined
}

export function chartQueryKey({
  chartName,
  hostId,
  interval,
  lastHours,
  params,
  timezone,
  connectionKey,
}: ChartQueryKeyParams) {
  return [
    '/api/v1/charts',
    chartName,
    hostId,
    interval,
    lastHours,
    JSON.stringify(params ?? null),
    timezone,
    connectionKey,
  ] as const
}

export interface TableQueryKeyParams {
  queryConfigName: string
  hostId?: number
  searchParams?: Record<string, unknown> | null
  timezone?: string
  /** Precompute via `hostConnectionKey(hostId, browserConnection)`. */
  connectionKey: string | undefined
}

export function tableQueryKey({
  queryConfigName,
  hostId,
  searchParams,
  timezone,
  connectionKey,
}: TableQueryKeyParams) {
  return [
    '/api/v1/tables',
    queryConfigName,
    hostId,
    JSON.stringify(searchParams ?? {}),
    timezone,
    connectionKey,
  ] as const
}
