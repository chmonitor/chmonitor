/**
 * PeerDB fleet-metrics endpoint — GET /api/v1/peerdb-metrics
 *
 * Aggregates the read-only PeerDB REST surface (the same allowlisted endpoints
 * the `/api/v1/peerdb/*` proxy exposes — mirrors list/status, peers list/slots,
 * per-mirror rows-synced) into one fleet-health summary via the shared pure
 * `summarizePeerDBFleet`, so cards and pages render a single fetch instead of
 * fanning out per mirror.
 *
 * Read-only: only allowlisted GET/POST paths are ever requested upstream;
 * mutating endpoints are unreachable by construction. Graceful by contract:
 * unconfigured PeerDB returns a 200 `configured:false` payload (never an
 * error), per-mirror/per-peer failures degrade to `partial:true`, and only a
 * total upstream failure (mirrors list unreadable) returns 502.
 *
 * Responses for the env-wide config are cached in-memory for 30s so fleet
 * pages + auto-refresh collapse into one upstream burst. Per-connection
 * (`?connection=<id>`) responses are NEVER cached or served from cache: the
 * cache is keyed without any user identity, so serving a per-connection
 * request from it could leak one user's fleet data to another. Config
 * resolution (including the fail-closed ownership check) always runs first.
 *
 * Query parameters:
 * - connection (optional): per-user connection id (`?connection=<id>`);
 *   otherwise the env-wide config is used (same resolution as the proxy).
 */

import { createFileRoute } from '@tanstack/react-router'

import type {
  ListMirrorsResponse,
  ListPeersResponse,
  MirrorStatusResponse,
  PeerSlotResponse,
  SlotInfo,
  TotalRowsSyncedResponse,
} from '@/lib/peerdb/types'

import { env } from 'cloudflare:workers'
import { generateRequestId } from '@chm/logger'
import { summarizePeerDBFleet } from '@/lib/peerdb/fleet-metrics'
import {
  buildPeerDBAuthHeader,
  envPeerDBConfig,
  type ResolvedPeerDBConfig,
} from '@/lib/peerdb/peerdb-auth'
import {
  PEERDB_CONNECTION_PARAM,
  resolvePeerDBRequestConfig,
} from '@/lib/peerdb/resolve-request-config'

class PeerDBError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'PeerDBError'
  }
}

const FALLBACK_FETCH_TIMEOUT_MS = 10_000
/** Upper bound on per-mirror/per-peer fan-out per request. */
const FLEET_FANOUT_CAP = 50
/** In-memory cache TTL: collapse page mount + auto-refresh into one burst. */
const METRICS_CACHE_TTL_MS = 30_000

/**
 * Upstream timeout, read lazily per request (not at module scope): on Workers
 * the `env` binding is per-request state, so a module-level read would pin the
 * first isolate's value and ignore later `PEERDB_FETCH_TIMEOUT_MS` changes.
 */
function resolveFetchTimeoutMs(
  bindings: Record<string, string | undefined>
): number {
  const raw = (bindings.PEERDB_FETCH_TIMEOUT_MS ?? '').trim()
  if (!raw) return FALLBACK_FETCH_TIMEOUT_MS
  const parsed = Math.floor(Number(raw))
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : FALLBACK_FETCH_TIMEOUT_MS
}

interface CacheEntry {
  at: number
  body: unknown
}
const metricsCache = new Map<string, CacheEntry>()

/** Strip credentials and path so only the origin is exposed to the browser. */
function sanitizeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
      .replace(/^[a-z]+:\/\//i, '')
      .split('@')
      .pop()!
      .split('/')[0]
  }
}

async function peerdbFetch<T>(
  config: ResolvedPeerDBConfig,
  path: string,
  timeoutMs: number,
  init?: { method: 'GET' | 'POST'; body?: string }
): Promise<T> {
  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      body: init?.body,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...buildPeerDBAuthHeader(config),
      },
    })
    if (!response.ok) {
      throw new PeerDBError(
        `PeerDB API error ${response.status}: ${response.statusText}`,
        response.status
      )
    }
    return (await response.json()) as T
  } catch (err) {
    if (err instanceof PeerDBError) throw err
    const aborted = err instanceof Error && err.name === 'AbortError'
    throw new PeerDBError(
      aborted
        ? `PeerDB request timed out after ${timeoutMs}ms`
        : `Failed to reach PeerDB: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
      502
    )
  } finally {
    clearTimeout(timeout)
  }
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function handleGet(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  const bindings = env as Record<string, string | undefined>
  const connectionId = new URL(request.url).searchParams.get(
    PEERDB_CONNECTION_PARAM
  )

  // Resolve + authenticate FIRST: an explicit `?connection=<id>` that cannot
  // be resolved (not signed in, not owned, no PeerDB link) fails closed to
  // null. The cache below is only consulted for the env-wide config — never
  // for a per-connection request, and never before this ownership check.
  const config = await resolvePeerDBRequestConfig(request, bindings)
  const timeoutMs = resolveFetchTimeoutMs(bindings)
  if (!config) {
    // Fail-closed sibling note: an explicit `?connection=<id>` that cannot be
    // resolved reports the same not-configured shape (never leaks existence).
    // Also surface whether the deployment has ANY env-wide PeerDB config so
    // the UI can distinguish "not configured" from "no access".
    const envConfigured = envPeerDBConfig(bindings) !== null
    const body = {
      success: true,
      data: {
        configured: false,
        envConfigured,
        metrics: summarizePeerDBFleet({}),
        partial: false,
        generatedAt: new Date().toISOString(),
      },
      metadata: { queryId: requestId },
    }
    return Response.json(body, { headers: { 'X-Request-ID': requestId } })
  }

  // Env-wide responses are cached (per-connection responses never are — see
  // the docblock). The not-configured branch above returns before any cache
  // write, so a warm env cache can never mask a failed ownership check.
  const useCache = connectionId === null
  const cacheKey = 'peerdb-metrics:env'
  if (useCache) {
    const cached = metricsCache.get(cacheKey)
    if (cached && Date.now() - cached.at < METRICS_CACHE_TTL_MS) {
      return Response.json(cached.body, {
        headers: { 'X-Request-ID': requestId },
      })
    }
  }

  const respond = (body: unknown, status = 200) => {
    if (status === 200 && useCache) {
      metricsCache.set(cacheKey, { at: Date.now(), body })
      if (metricsCache.size > 50) {
        const oldest = metricsCache.keys().next().value
        if (oldest !== undefined) metricsCache.delete(oldest)
      }
    }
    return Response.json(body, {
      status,
      headers: { 'X-Request-ID': requestId },
    })
  }

  // Mirrors list is the fleet root — its failure is the only total failure.
  let mirrors: ListMirrorsResponse['mirrors'] = []
  try {
    const list = await peerdbFetch<ListMirrorsResponse>(
      config,
      '/v1/mirrors/list',
      timeoutMs
    )
    mirrors = Array.isArray(list?.mirrors) ? list.mirrors : []
  } catch (err) {
    const status = err instanceof PeerDBError ? err.status : 502
    return respond(
      {
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'PeerDB request failed',
        },
        metadata: { queryId: requestId },
      },
      status
    )
  }

  const scoped = mirrors
    .filter((m) => typeof m?.name === 'string' && m.name)
    .slice(0, FLEET_FANOUT_CAP)
  let partial = false

  const statusEntries = await Promise.all(
    scoped.map(async (m) => {
      try {
        const s = await peerdbFetch<MirrorStatusResponse>(
          config,
          '/v1/mirrors/status',
          timeoutMs,
          { method: 'POST', body: JSON.stringify({ flow_job_name: m.name }) }
        )
        return [m.name, s] as const
      } catch {
        partial = true
        return null
      }
    })
  )
  const statuses = new Map<string, MirrorStatusResponse>()
  for (const e of statusEntries) if (e) statuses.set(e[0], e[1])

  const rowsSynced = new Map<string, number>()
  await Promise.all(
    scoped.map(async (m) => {
      try {
        const r = await peerdbFetch<TotalRowsSyncedResponse>(
          config,
          `/v1/mirrors/total_rows_synced/${encodeURIComponent(m.name)}`,
          timeoutMs
        )
        const n = toNum(r?.totalRowsSynced ?? r?.totalCount)
        if (n !== null) rowsSynced.set(m.name, n)
      } catch {
        partial = true
      }
    })
  )

  let slotEntries: { name: string; slots: SlotInfo[] }[] = []
  try {
    const peers = await peerdbFetch<ListPeersResponse>(
      config,
      '/v1/peers/list',
      timeoutMs
    )
    const names = [
      ...((peers?.sourceItems ?? []).map((p) => p?.name) as string[]),
      ...((peers?.items ?? []).map((p) => p?.name) as string[]),
    ].filter((n, i, a) => typeof n === 'string' && n && a.indexOf(n) === i)
    slotEntries = await Promise.all(
      names.slice(0, FLEET_FANOUT_CAP).map(async (peer) => {
        try {
          const s = await peerdbFetch<PeerSlotResponse>(
            config,
            `/v1/peers/slots/${encodeURIComponent(peer)}`,
            timeoutMs
          )
          return {
            name: peer,
            slots: Array.isArray(s?.slotData) ? s.slotData : [],
          }
        } catch {
          partial = true
          return { name: peer, slots: [] }
        }
      })
    )
  } catch {
    partial = true
  }

  const metrics = summarizePeerDBFleet({
    mirrors: scoped,
    statuses,
    slots: slotEntries,
    rowsSynced,
  })

  return respond({
    success: true,
    data: {
      configured: true,
      host: sanitizeHost(config.baseUrl),
      metrics,
      partial,
      generatedAt: new Date().toISOString(),
    },
    metadata: { queryId: requestId },
  })
}

export const Route = createFileRoute('/api/v1/peerdb-metrics')({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
    },
  },
})

export { handleGet as __handlerForTests }
