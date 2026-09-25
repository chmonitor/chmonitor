/**
 * PeerDB connection config + server-side fetch client.
 *
 * PeerDB exposes a REST API (grpc-gateway) on the flow-api service, typically
 * `http://<flow-api-host>:8113/v1/*`. `PEERDB_PASSWORD` is sent as empty-user
 * HTTP Basic by default, or as a Bearer token when `PEERDB_AUTH_SCHEME=bearer`.
 * When no password is set, the API is open. The Authorization header is
 * constructed server-side only and never reaches the browser bundle.
 *
 * This is single-instance (one PeerDB deployment) — unlike ClickHouse's
 * multi-host config — because PeerDB monitoring targets a single flow-api.
 */

import {
  buildPeerDBAuthHeader,
  type PeerDBAuthScheme,
  parsePeerDBAuthScheme,
} from './peerdb-auth'
import { debug, error } from '@chm/logger'

export interface PeerDBConfig {
  /** Base URL of the PeerDB flow-api, e.g. http://localhost:8113 */
  baseUrl: string
  /** UI/API secret used as the Basic password or Bearer token. */
  password?: string
  /** Auth scheme for {@link password}; defaults to Basic when omitted. */
  authScheme?: PeerDBAuthScheme
}

/** True when a PeerDB API URL is configured for this deployment. */
export function isPeerDBEnabled(): boolean {
  return Boolean(process.env.PEERDB_API_URL?.trim())
}

/** Read PeerDB config from env, or null when not configured. */
export function getPeerDBConfig(): PeerDBConfig | null {
  const baseUrl = process.env.PEERDB_API_URL?.trim()
  if (!baseUrl) return null

  const password = process.env.PEERDB_PASSWORD?.trim() || undefined
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    password,
    ...(password
      ? { authScheme: parsePeerDBAuthScheme(process.env.PEERDB_AUTH_SCHEME) }
      : {}),
  }
}

function authHeader(config: PeerDBConfig): Record<string, string> {
  return buildPeerDBAuthHeader({
    authScheme: config.authScheme,
    secret: config.password,
  })
}

export class PeerDBError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'PeerDBError'
  }
}

export function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback

  const normalized = Math.floor(parsed)
  return normalized >= 0 ? normalized : fallback
}

/**
 * Server-side fetch against the PeerDB REST API.
 *
 * @param path  API path beginning with `/v1/...`
 * @param init  Standard fetch init (method/body/headers)
 * @throws {PeerDBError} when PeerDB is unconfigured or the upstream is non-2xx
 */
/**
 * Short-TTL in-memory response cache. Many rows + auto-refresh would otherwise
 * fan out to the PeerDB API repeatedly; caching identical (method+path+body)
 * reads for a few seconds collapses bursts and refresh cycles into one upstream
 * call. TTL is tunable via PEERDB_CACHE_TTL_MS (default 10s; 0 disables).
 */
const CACHE_TTL_MS = readNonNegativeIntEnv('PEERDB_CACHE_TTL_MS', 10_000)
const CACHE_MAX_ENTRIES = readNonNegativeIntEnv('PEERDB_CACHE_MAX_ENTRIES', 500)
const FETCH_TIMEOUT_MS =
  readNonNegativeIntEnv('PEERDB_FETCH_TIMEOUT_MS', 10_000) || 10_000
const responseCache = new Map<string, { at: number; value: unknown }>()

/**
 * Drop expired entries and enforce the size bound (oldest-first) so the cache
 * cannot grow without limit in a long-running server process. Map preserves
 * insertion order, so the first keys are the oldest writes.
 */
function pruneCache(now: number): void {
  for (const [k, v] of responseCache) {
    if (now - v.at >= CACHE_TTL_MS) responseCache.delete(k)
  }
  while (responseCache.size > CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value
    if (oldest === undefined) break
    responseCache.delete(oldest)
  }
}

export async function peerdbFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const config = getPeerDBConfig()
  if (!config) {
    throw new PeerDBError('PeerDB is not configured on this deployment', 503)
  }

  const method = init?.method ?? 'GET'
  const cacheKey = `${method} ${path} ${typeof init?.body === 'string' ? init.body : ''}`
  if (CACHE_TTL_MS > 0) {
    const hit = responseCache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.value as T
    }
  }

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  debug('[PeerDB] fetch', { method, url })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
        ...authHeader(config),
      },
    })
  } catch (err) {
    error('[PeerDB] connection failed', { url: config.baseUrl, err })
    const aborted = err instanceof Error && err.name === 'AbortError'
    // Keep the upstream host out of the client-facing message; log it above.
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
    const body = await response.text().catch(() => '')
    // Log the full response for debugging but keep it out of the error message
    error('[PeerDB] upstream error', {
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 300),
    })
    throw new PeerDBError(
      `PeerDB API error ${response.status}: ${response.statusText}`,
      response.status
    )
  }

  const value = (await response.json()) as T
  if (CACHE_TTL_MS > 0) {
    const now = Date.now()
    responseCache.set(cacheKey, { at: now, value })
    pruneCache(now)
  }
  return value
}
