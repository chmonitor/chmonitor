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

/**
 * Canonical serialization of chart `params` for the cache key. Callers
 * (`useChartData`, `prefetch`) serialize ONCE via this helper and pass the
 * result as `paramsKey`, so the byte-identical-key contract holds without
 * stringifying the same object twice per render.
 */
export function serializeChartParams(
  params?: Record<string, unknown> | null
): string {
  return JSON.stringify(params ?? null)
}

export interface ChartQueryKeyParams {
  chartName: string
  hostId?: number | string
  interval?: string
  lastHours?: number
  /** Precompute via `serializeChartParams(params)`. */
  paramsKey: string
  timezone?: string
  /** Precompute via `hostConnectionKey(numericHostId, browserConnection)`. */
  connectionKey: string | undefined
}

export function chartQueryKey({
  chartName,
  hostId,
  interval,
  lastHours,
  paramsKey,
  timezone,
  connectionKey,
}: ChartQueryKeyParams) {
  return [
    '/api/v1/charts',
    chartName,
    hostId,
    interval,
    lastHours,
    paramsKey,
    timezone,
    connectionKey,
  ] as const
}

/**
 * Canonical serialization of table `searchParams` for the cache key. Callers
 * (`useTableData`, `prefetch`) serialize ONCE via this helper and pass the
 * result as `searchParamsKey`.
 */
export function serializeTableSearchParams(
  searchParams?: Record<string, unknown> | null
): string {
  return JSON.stringify(searchParams ?? {})
}

export interface TableQueryKeyParams {
  queryConfigName: string
  hostId?: number
  /** Precompute via `serializeTableSearchParams(searchParams)`. */
  searchParamsKey: string
  timezone?: string
  /** Precompute via `hostConnectionKey(hostId, browserConnection)`. */
  connectionKey: string | undefined
}

export function tableQueryKey({
  queryConfigName,
  hostId,
  searchParamsKey,
  timezone,
  connectionKey,
}: TableQueryKeyParams) {
  return [
    '/api/v1/tables',
    queryConfigName,
    hostId,
    searchParamsKey,
    timezone,
    connectionKey,
  ] as const
}
