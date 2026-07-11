/**
 * PeerDB connection status (server-side probe).
 *
 * Returns a typed, browser-safe summary the connection pill can render without
 * sniffing HTTP status codes: whether PeerDB is configured, the sanitized host
 * (origin only — never credentials), and the live reachability/auth state from
 * a cheap `/version` probe.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { generateRequestId } from '@chm/logger'
import {
  buildPeerDBAuthHeader,
  type ResolvedPeerDBConfig,
} from '@/lib/peerdb/peerdb-auth'
import { resolvePeerDBRequestConfig } from '@/lib/peerdb/resolve-request-config'

/** Browser-safe PeerDB connection status payload. */
interface PeerDBStatusPayload {
  configured: boolean
  /** Sanitized host as `hostname:port` (no scheme/credentials/path), or null. */
  host: string | null
  state: 'connected' | 'auth' | 'unreachable' | 'not-configured'
  version?: string
  error?: string
}

type PeerDBConfig = ResolvedPeerDBConfig

interface VersionResponse {
  version?: string
}

class PeerDBError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'PeerDBError'
  }
}

/** Strip credentials and path so only the origin is exposed to the browser. */
function sanitizeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    let sanitized = baseUrl.replace(/^[a-z]+:\/\//i, '')
    const atIndex = sanitized.indexOf('@')
    if (atIndex !== -1) {
      sanitized = sanitized.slice(atIndex + 1)
    }
    return sanitized.split('/')[0]
  }
}

const FETCH_TIMEOUT_MS = 10_000

async function peerdbFetch<T = unknown>(
  config: PeerDBConfig,
  path: string
): Promise<T> {
  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...buildPeerDBAuthHeader(config),
      },
    })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    throw new PeerDBError(
      aborted
        ? `PeerDB request timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Failed to reach PeerDB: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
      502
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new PeerDBError(
      `PeerDB API error ${response.status}: ${response.statusText}`,
      response.status
    )
  }

  return (await response.json()) as T
}

export const Route = createFileRoute('/api/v1/peerdb-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        const requestId = generateRequestId()

        // Env config, OR a per-connection PeerDB link when `?connection=<id>`
        // is present and the signed-in user owns that connection.
        const config = await resolvePeerDBRequestConfig(request, bindings)

        if (!config) {
          const payload: PeerDBStatusPayload = {
            configured: false,
            host: null,
            state: 'not-configured',
          }
          return Response.json(
            { success: true, data: payload, metadata: { queryId: requestId } },
            { status: 200 }
          )
        }

        const host = sanitizeHost(config.baseUrl)

        try {
          const version = await peerdbFetch<VersionResponse>(
            config,
            '/v1/version'
          )
          const payload: PeerDBStatusPayload = {
            configured: true,
            host,
            state: 'connected',
            version: version.version,
          }
          return Response.json(
            { success: true, data: payload, metadata: { queryId: requestId } },
            { status: 200 }
          )
        } catch (err) {
          const status = err instanceof PeerDBError ? err.status : 0
          const state =
            status === 401 || status === 403 ? 'auth' : 'unreachable'
          const payload: PeerDBStatusPayload = {
            configured: true,
            host,
            state,
            error: err instanceof Error ? err.message : 'PeerDB probe failed',
          }
          return Response.json(
            { success: true, data: payload, metadata: { queryId: requestId } },
            { status: 200 }
          )
        }
      },
    },
  },
})
