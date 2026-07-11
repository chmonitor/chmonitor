import { useQuery } from '@tanstack/react-query'

import { apiFetch } from './api-fetch'
import { NON_CRITICAL_RETRY, visibilityAwareInterval } from './config'
import { maybePingInstance } from '@/lib/telemetry'

/** API response format for host status */
type HostStatusApiResponse = {
  success: boolean
  data?: {
    version: string
    uptime: string
    hostname: string
    databases?: number
    tables?: number
    clusterNodes?: number
  }
  error?: string
}

/** Host status information */
export type HostStatus = {
  version: string
  uptime: string
  hostname: string
  /** Number of databases (only when `includeCounts` is requested). */
  databases?: number
  /** Number of tables (only when `includeCounts` is requested). */
  tables?: number
  /** Distinct cluster nodes (only when `includeCounts` is requested). */
  clusterNodes?: number
}

interface UseHostStatusOptions {
  /**
   * Refresh interval in milliseconds.
   * @default 60000 (1 minute)
   */
  refreshInterval?: number
  /**
   * Whether to revalidate on window focus.
   * @default false
   */
  revalidateOnFocus?: boolean
  /**
   * Also fetch cross-host comparison counts (databases/tables/cluster nodes)
   * for the Fleet table. Off by default so the widely-polled status probe stays
   * a single round-trip. Uses a distinct query key from the countless variant.
   * @default false
   */
  includeCounts?: boolean
}

/**
 * TanStack Query hook to fetch host status (version, uptime, hostname).
 * Uses a unified API endpoint for better caching efficiency.
 *
 * @param hostId - The host ID to fetch status for
 * @param options - Query configuration options
 * @returns {Object} Query state with data, error, isLoading, and online state
 *
 * @example
 * ```typescript
 * const { data, error, isLoading } = useHostStatus(0)
 * // data: { version: '24.3.1.1', uptime: '1 day 2 hours', hostname: 'clickhouse-01' }
 * ```
 */
export function useHostStatus(
  hostId: number | null,
  options: UseHostStatusOptions = {}
) {
  const {
    refreshInterval = 60000,
    revalidateOnFocus = false,
    includeCounts = false,
  } = options

  // Skip status check for browser connections (negative hostId) — they have
  // no server-side host entry and the proxy endpoint handles connectivity.
  const isBrowserConnection = hostId !== null && hostId < 0

  const url = includeCounts
    ? `/api/v1/host-status?hostId=${hostId}&counts=1`
    : `/api/v1/host-status?hostId=${hostId}`
  const queryKey = [url]

  const { data, error, isLoading } = useQuery<HostStatus>({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch(url)
      if (!res.ok) {
        throw new Error(`Failed to fetch host status: ${res.statusText}`)
      }
      const json: HostStatusApiResponse = await res.json()
      if (!json.success || !json.data) {
        throw new Error(json.error || 'No data returned')
      }
      // Thread the ClickHouse version and hostname to telemetry ping
      if (json.data.version) {
        maybePingInstance(undefined, json.data.version, json.data.hostname)
      }
      return {
        version: json.data.version,
        uptime: json.data.uptime,
        hostname: json.data.hostname,
        databases: json.data.databases,
        tables: json.data.tables,
        clusterNodes: json.data.clusterNodes,
      }
    },
    enabled: hostId !== null && !isBrowserConnection,
    staleTime: 10000,
    refetchInterval:
      refreshInterval > 0 ? visibilityAwareInterval(refreshInterval) : false,
    refetchOnWindowFocus: revalidateOnFocus,
    refetchOnReconnect: true,
    // Non-critical always-on poll: cap retries so a transient blip doesn't
    // amplify into repeated Worker→ClickHouse round-trips (the next scheduled
    // refetch recovers anyway). See NON_CRITICAL_RETRY.
    retry: NON_CRITICAL_RETRY,
  })

  return {
    data: data ?? null,
    error,
    isLoading,
    isOnline: data?.version !== '' && data?.version !== undefined,
  }
}
