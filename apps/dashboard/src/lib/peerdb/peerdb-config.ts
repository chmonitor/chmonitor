/**
 * PeerDB connection config + server-side fetch client.
 *
 * PeerDB exposes a REST API (grpc-gateway) on the flow-api service, typically
 * `http://<flow-api-host>:8113/v1/*`. Auth is HTTP Basic with an EMPTY username
 * by default, or Bearer when `PEERDB_AUTH_SCHEME=bearer`; when no password is
 * set, the API is open. The Authorization header is constructed server-side
 * only and never reaches the browser bundle.
 *
 * This is single-instance (one PeerDB deployment) — unlike ClickHouse's
 * multi-host config — because PeerDB monitoring targets a single flow-api.
 */

import {
  buildPeerDBAuthHeader,
  envPeerDBConfig,
  type ResolvedPeerDBConfig,
} from './peerdb-auth'
import { debug, error } from '@chm/logger'

export interface PeerDBConfig {
  /** Base URL of the PeerDB flow-api, e.g. http://localhost:8113 */
  baseUrl: string
  /** UI/API secret (Basic password or Bearer token) for the legacy config shape. */
  password?: string
}

function envBindings(): Record<string, string | undefined> {
  if (typeof process === 'undefined' || !process.env) return {}
  return process.env as Record<string, string | undefined>
}

/** Resolve the current env config without baking Worker bindings at module load. */
function currentConfig(): ResolvedPeerDBConfig | null {
  try {
    return envPeerDBConfig(envBindings())
  } catch {
    return null
  }
}

/** True when a PeerDB API URL is configured for this deployment. */
export function isPeerDBEnabled(): boolean {
  return currentConfig() !== null
}

/**
 * Legacy env config shape used by the gate and older callers. Fetch code uses
 * `currentConfig()` directly so the auth scheme is not lost.
 */
export function getPeerDBConfig(): PeerDBConfig | null {
  const config = currentConfig()
  if (!config) return null
  return {
    baseUrl: config.baseUrl,
    password: config.secret,
  }
}

/**
 * Why a PeerDB request failed, kept distinct so operators are not sent looking
 * for a network problem that does not exist (#3677). A 10s
 * `PEERDB_FETCH_TIMEOUT_MS` abort and a refused connection both used to log as
 * `[PeerDB] connection failed`, which reads as "the network is broken".
 *
 * - `timeout`   — our own request deadline elapsed (the PeerDB side is slow or
 *                 saturated). Not a connectivity problem.
 * - `aborted`   — the caller cancelled via `init.signal` (e.g. sweep budget).
 * - `auth`      — 401/403: wrong/missing `PEERDB_PASSWORD`.
 * - `refused`   — TCP connect refused (nothing listening / pod down).
 * - `dns`       — name resolution failed.
 * - `tls`       — certificate verification failed.
 * - `network`   — any other transport failure.
 * - `unconfigured` — `PEERDB_API_URL` unset (no request was made).
 * - `upstream`  — PeerDB answered with a non-2xx status.
 */
export type PeerDBFetchFailure =
  | 'unconfigured'
  | 'timeout'
  | 'aborted'
  | 'auth'
  | 'refused'
  | 'dns'
  | 'tls'
  | 'network'
  | 'upstream'

/** Short human label per failure kind — the log/UI discriminator. */
const FAILURE_LABEL: Record<PeerDBFetchFailure, string> = {
  unconfigured: 'not configured',
  timeout: 'request timed out',
  aborted: 'request aborted',
  auth: 'auth failed',
  refused: 'connection refused',
  dns: 'dns lookup failed',
  tls: 'tls handshake failed',
  network: 'network unreachable',
  upstream: 'upstream error',
}

/** Log/UI label for a failure kind. */
export function peerDBFailureLabel(kind: PeerDBFetchFailure): string {
  return FAILURE_LABEL[kind]
}

export class PeerDBError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Optional failure kind so the classification survives the wrap (#3677). */
    readonly kind?: PeerDBFetchFailure
  ) {
    super(message)
    this.name = 'PeerDBError'
  }
}

/** Node/libuv error codes that mean "the peer actively refused the connect". */
const REFUSED_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
])
/** Name-resolution failure codes. */
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL'])
/** Transport-level timeout codes (distinct from our AbortController deadline). */
const SOCKET_TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
])
/** Certificate verification failure codes. */
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/**
 * First `code` found on the error or its `cause` chain. `fetch` wraps the real
 * Node error one level down (`TypeError: fetch failed` → `cause.code`), and
 * that `cause` is invisible in a JSON log unless it is read explicitly.
 */
function causeCode(err: unknown, depth = 0): string | undefined {
  if (depth > 4 || typeof err !== 'object' || err === null) return undefined
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && code !== '') return code
  return causeCode((err as { cause?: unknown }).cause, depth + 1)
}

/**
 * Classify a thrown fetch/config error into a {@link PeerDBFetchFailure}.
 *
 * A bare `AbortError` is classified `timeout` — the deadline in this module is
 * the only thing that aborts by default. When the caller passed its own
 * `init.signal` and THAT is the aborted one, pass `{ callerAborted: true }` so
 * it is reported as `aborted` (a cancelled sweep) rather than a slow PeerDB.
 */
export function classifyPeerDBFetchFailure(
  err: unknown,
  opts?: { callerAborted?: boolean }
): PeerDBFetchFailure {
  if (err instanceof PeerDBError && err.kind) return err.kind
  if (err instanceof PeerDBError) {
    if (err.status === 503) return 'unconfigured'
    if (err.status === 401 || err.status === 403) return 'auth'
    return 'upstream'
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return opts?.callerAborted ? 'aborted' : 'timeout'
  }
  const code = causeCode(err)
  if (code) {
    if (REFUSED_CODES.has(code)) return 'refused'
    if (DNS_CODES.has(code)) return 'dns'
    if (SOCKET_TIMEOUT_CODES.has(code)) return 'timeout'
    if (TLS_CODES.has(code)) return 'tls'
  }
  return 'network'
}

/**
 * Flatten an error into loggable fields. `JSON.stringify(new Error(...))` is
 * `{}` — the name, message and `cause.code` that identify the failure are all
 * non-enumerable — so they must be lifted out explicitly (#3677).
 */
export function describePeerDBFailure(err: unknown): {
  errName: string
  errMessage: string
  causeCode?: string
} {
  const errName = err instanceof Error ? err.name : typeof err
  const errMessage = err instanceof Error ? err.message : String(err)
  const code = causeCode(err)
  return {
    errName,
    errMessage,
    ...(code ? { causeCode: code } : {}),
  }
}

export function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = envBindings()[name]?.trim()
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
 * @param init  Standard fetch init (method/body/headers). `init.signal` is
 *   honoured: passing one lets a caller (e.g. the alert sweep's wall-clock
 *   budget) cancel in-flight reads, which is reported as `aborted` rather than
 *   `timeout`.
 * @throws {PeerDBError} carrying a {@link PeerDBFetchFailure} `kind` when
 *   PeerDB is unconfigured, the request timed out / was aborted, the transport
 *   failed, or the upstream answered non-2xx.
 */
/**
 * Short-TTL in-memory response cache. Many rows + auto-refresh would otherwise
 * fan out to the PeerDB API repeatedly; caching identical (method+path+body)
 * reads for a few seconds collapses bursts and refresh cycles into one upstream
 * call. TTL is tunable via PEERDB_CACHE_TTL_MS (default 10s; 0 disables).
 */
const responseCache = new Map<string, { at: number; value: unknown }>()

/**
 * Drop expired entries and enforce the size bound (oldest-first) so the cache
 * cannot grow without limit in a long-running server process. Map preserves
 * insertion order, so the first keys are the oldest writes.
 */
function pruneCache(now: number, ttlMs: number, maxEntries: number): void {
  for (const [k, v] of responseCache) {
    if (now - v.at >= ttlMs) responseCache.delete(k)
  }
  while (responseCache.size > maxEntries) {
    const oldest = responseCache.keys().next().value
    if (oldest === undefined) break
    responseCache.delete(oldest)
  }
}

export async function peerdbFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const config = currentConfig()
  if (!config) {
    throw new PeerDBError(
      'PeerDB is not configured on this deployment',
      503,
      'unconfigured'
    )
  }

  const cacheTtlMs = readNonNegativeIntEnv('PEERDB_CACHE_TTL_MS', 10_000)
  const cacheMaxEntries = readNonNegativeIntEnv('PEERDB_CACHE_MAX_ENTRIES', 500)
  const fetchTimeoutMs =
    readNonNegativeIntEnv('PEERDB_FETCH_TIMEOUT_MS', 10_000) || 10_000
  const method = init?.method ?? 'GET'
  const cacheKey = `${method} ${path} ${typeof init?.body === 'string' ? init.body : ''}`
  if (cacheTtlMs > 0) {
    const hit = responseCache.get(cacheKey)
    if (hit && Date.now() - hit.at < cacheTtlMs) {
      return hit.value as T
    }
  }

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  debug('[PeerDB] fetch', { method, url })

  // Our deadline AND any caller-supplied signal (e.g. the alert sweep's wall
  // clock budget, #3677) must abort this request. Previously `init.signal` was
  // silently overwritten, so a caller could never cancel.
  const controller = new AbortController()
  const callerSignal = init?.signal
  const onCallerAbort = () => controller.abort()
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs)

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
        ...buildPeerDBAuthHeader(config),
      },
    })
  } catch (err) {
    const callerAborted = Boolean(callerSignal?.aborted)
    const kind = classifyPeerDBFetchFailure(err, { callerAborted })
    // `err` serialises to `{}` — log the lifted name/message/cause.code so the
    // abort is actually diagnosable, and name the failure instead of calling
    // every transport problem a "connection failed" (#3677).
    error(`[PeerDB] ${peerDBFailureLabel(kind)}`, err, {
      url: config.baseUrl,
      method,
      path,
      kind,
      ...(callerAborted ? {} : { timeoutMs: fetchTimeoutMs }),
      ...describePeerDBFailure(err),
    })
    // Keep the upstream host out of the client-facing message; log it above.
    const message =
      kind === 'timeout'
        ? `PeerDB request timed out after ${fetchTimeoutMs}ms`
        : kind === 'aborted'
          ? 'PeerDB request aborted before completion'
          : kind === 'auth'
            ? `PeerDB rejected the configured credentials (${err instanceof Error ? err.message : 'auth failed'})`
            : kind === 'refused'
              ? 'Failed to reach PeerDB: connection refused'
              : `Failed to reach PeerDB: ${err instanceof Error ? err.message : 'unknown error'}`
    throw new PeerDBError(message, 502, kind)
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const kind: PeerDBFetchFailure =
      response.status === 401 || response.status === 403 ? 'auth' : 'upstream'
    // Log the full response for debugging but keep it out of the error message
    error(`[PeerDB] ${peerDBFailureLabel(kind)}`, undefined, {
      url: config.baseUrl,
      method,
      path,
      kind,
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 300),
    })
    throw new PeerDBError(
      `PeerDB API error ${response.status}: ${response.statusText}`,
      response.status,
      kind
    )
  }

  const value = (await response.json()) as T
  if (cacheTtlMs > 0) {
    const now = Date.now()
    responseCache.set(cacheKey, { at: now, value })
    pruneCache(now, cacheTtlMs, cacheMaxEntries)
  }
  return value
}
