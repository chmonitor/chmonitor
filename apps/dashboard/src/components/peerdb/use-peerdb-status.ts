import { useQuery } from '@tanstack/react-query'

import type { ApiResponse } from '@/lib/api/types'
import type { PeerDBStatusPayload } from '@/lib/peerdb/types'

import { useSearchParams } from '@/lib/next-compat'
import { PEERDB_CONNECTION_PARAM } from '@/lib/peerdb/peerdb-auth'
import { apiFetch } from '@/lib/swr/api-fetch'

const STATUS_URL = '/api/v1/peerdb-status'

async function fetchStatus(url: string): Promise<PeerDBStatusPayload> {
  try {
    const response = await apiFetch(url)
    if (!response.ok) {
      throw new Error(`PeerDB status probe failed (${response.status})`)
    }
    const json = (await response.json()) as ApiResponse<PeerDBStatusPayload>
    const data = json?.data
    if (!data || typeof data.state !== 'string') {
      throw new Error('Malformed PeerDB status response')
    }
    return data
  } catch (err) {
    throw new Error(
      `Failed to fetch PeerDB status: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

/**
 * Shared SWR hook for the server-side PeerDB connection probe. Validates the
 * response shape so callers (the header pill + mirrors header chip) never
 * consume malformed data.
 *
 * `connection` targets a per-user connection's PeerDB link (`?connection=<id>`);
 * omitted, it defaults to the active `?connection=` URL search param, and
 * `null`/`''` forces the env-wide config.
 */
export function usePeerDBStatus(
  refreshInterval = 60_000,
  connection?: string | null
) {
  const searchParams = useSearchParams()
  const activeConnection =
    connection === undefined
      ? (searchParams.get(PEERDB_CONNECTION_PARAM) ?? undefined)
      : (connection ?? undefined)
  const url = activeConnection
    ? `${STATUS_URL}?${PEERDB_CONNECTION_PARAM}=${encodeURIComponent(activeConnection)}`
    : STATUS_URL
  return useQuery<PeerDBStatusPayload>({
    queryKey: [STATUS_URL, activeConnection ?? ''],
    queryFn: () => fetchStatus(url),
    refetchInterval: refreshInterval,
    retry: false,
  })
}
