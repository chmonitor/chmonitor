import { useQuery } from '@tanstack/react-query'

import type { ApiResponse } from '@/lib/api/types'
import type { PeerDBFleetMetrics } from '@/lib/peerdb/fleet-metrics'

import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { PEERDB_CONNECTION_PARAM } from '@/lib/peerdb/peerdb-auth'
import { apiFetch } from '@/lib/swr/api-fetch'
import { visibilityAwareInterval } from '@/lib/swr/config'

const METRICS_URL = '/api/v1/peerdb-metrics'

/** Browser-safe payload of `GET /api/v1/peerdb-metrics`. */
export interface PeerDBMetricsPayload {
  configured: boolean
  /** Whether the deployment has any env-wide PeerDB config (not-configured hint). */
  envConfigured?: boolean
  host?: string | null
  metrics: PeerDBFleetMetrics
  /** True when some per-mirror/per-peer sub-fetch failed (subset degraded). */
  partial: boolean
  generatedAt: string
}

async function fetchMetrics(url: string): Promise<PeerDBMetricsPayload> {
  try {
    const response = await apiFetch(url)
    if (!response.ok) {
      throw new Error(`PeerDB metrics request failed (${response.status})`)
    }
    const json = (await response.json()) as ApiResponse<PeerDBMetricsPayload>
    const data = json?.data
    if (!data || typeof data.configured !== 'boolean' || !data.metrics) {
      throw new Error('Malformed PeerDB metrics response')
    }
    return data
  } catch (err) {
    throw new Error(
      `Failed to fetch PeerDB metrics: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

/**
 * Shared hook for the aggregated PeerDB fleet-metrics endpoint. One fetch
 * replaces the per-mirror status/slots fan-out for header KPIs and triage
 * strips; the server caches for 30s so mount + auto-refresh collapse.
 *
 * `connection` targets a per-user connection's PeerDB link (`?connection=<id>`);
 * omitted, it defaults to the active `?connection=` URL search param, and
 * `null`/`''` forces the env-wide config. Unconfigured PeerDB resolves to a
 * `configured:false` payload (not an error) so callers render the
 * not-configured empty state.
 */
export function usePeerDBMetrics(
  refreshInterval = 60_000,
  connection?: string | null
) {
  const searchParams = useUrlSearchParams()
  const activeConnection =
    connection === undefined
      ? (searchParams.get(PEERDB_CONNECTION_PARAM) ?? undefined)
      : (connection ?? undefined)
  const url = activeConnection
    ? `${METRICS_URL}?${PEERDB_CONNECTION_PARAM}=${encodeURIComponent(activeConnection)}`
    : METRICS_URL
  return useQuery<PeerDBMetricsPayload>({
    queryKey: [METRICS_URL, activeConnection ?? ''],
    queryFn: () => fetchMetrics(url),
    // Pause while the tab is hidden, like every other polling hook.
    refetchInterval: visibilityAwareInterval(refreshInterval),
    retry: false,
  })
}
