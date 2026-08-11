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
    runningQueries?: number
    memoryBytes?: number
    memoryTotalBytes?: number
    diskUsedBytes?: number
    diskTotalBytes?: number
    recentErrors?: number
    readonlyReplicas?: number
    replicationDelay?: number
    series?: number[]
  }
  error?: string
}

/** Host status information */
export type HostStatus = {
  version: string
  uptime: string
  hostname: string
  /** Number of databases (only when `fleet` is requested). */
  databases?: number
  /** Number of tables (only when `fleet` is requested). */
  tables?: number
  /** Distinct cluster nodes (only when `fleet` is requested). */
  clusterNodes?: number
  /** Currently running queries (`system.metrics`). */
  runningQueries?: number
  /** Resident memory in bytes (`asynchronous_metrics.MemoryResident`). */
  memoryBytes?: number
  /** Total OS memory in bytes (`asynchronous_metrics.OSMemoryTotal`). */
  memoryTotalBytes?: number
  /** Used disk space in bytes across `system.disks`. */
  diskUsedBytes?: number
  /** Total disk space in bytes across `system.disks`. */
  diskTotalBytes?: number
  /** Distinct error kinds last seen within the past hour (`system.errors`). */
  recentErrors?: number
  /** Replicas currently in read-only mode (`system.replicas`). */
  readonlyReplicas?: number
  /** Max replica absolute delay in seconds (`system.replicas`). */
  replicationDelay?: number
  /** Running-query samples over the last hour (`system.metric_log`), oldest first. */
  series?: number[]
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
   * Also fetch the Fleet metric bundle (databases/tables/cluster nodes, running
   * queries, memory, disk, replication, recent errors and the metric_log
   * sparkline series). Off by default so the widely-polled status probe (host
   * switcher, logo indicator) stays a single cheap round-trip. Every Fleet
   * surface passes `fleet: true`, so they share ONE query key per host and
   * TanStack Query dedupes them into a single request.
   * @default false
   */
  fleet?: boolean
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
    fleet = false,
  } = options

  // Skip status check for browser connections (negative hostId) — they have
  // no server-side host entry and the proxy endpoint handles connectivity.
  const isBrowserConnection = hostId !== null && hostId < 0

  const url = fleet
    ? `/api/v1/host-status?hostId=${hostId}&fleet=1`
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
        runningQueries: json.data.runningQueries,
        memoryBytes: json.data.memoryBytes,
        memoryTotalBytes: json.data.memoryTotalBytes,
        diskUsedBytes: json.data.diskUsedBytes,
        diskTotalBytes: json.data.diskTotalBytes,
        recentErrors: json.data.recentErrors,
        readonlyReplicas: json.data.readonlyReplicas,
        replicationDelay: json.data.replicationDelay,
        series: json.data.series,
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
