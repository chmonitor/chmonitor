/**
 * Fleet log patterns — GET /api/v1/peerdb/log-patterns (issue #3678)
 *
 * Reads `POST /v1/mirrors/logs` for every mirror server-side through the
 * bounded sweep pool, keeps lines inside `?window=1h|24h|7d` (default 24h),
 * and returns the in-window entries plus pattern groups and coverage
 * (`mirrorsRead`, `mirrorsTotal`, `mirrorsTruncated`, `partial`).
 *
 * A static route, so it wins over the read-only splat proxy (`peerdb/$.ts`).
 * Feature permission is enforced centrally by the API middleware, as for the
 * other PeerDB routes. Read-only: only `GET /v1/mirrors/list` and
 * `POST /v1/mirrors/logs` are requested upstream.
 *
 * Caching mirrors `peerdb-metrics.ts`: env-wide responses are cached in memory
 * per window for 30s; per-connection (`?connection=<id>`) responses are never
 * cached, and config resolution (the ownership check) always runs first.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { ListMirrorsResponse } from '@/lib/peerdb/types'

import { env } from 'cloudflare:workers'
import { generateRequestId } from '@chm/logger'
import { parseTs } from '@/components/peerdb/peerdb-utils'
import {
  collectFleetLogPatterns,
  LOG_PATTERNS_PER_MIRROR,
  parseLogWindow,
} from '@/lib/peerdb/log-patterns-aggregate'
import {
  extractMirrorLogs,
  mirrorLogsRequestBody,
} from '@/lib/peerdb/mirror-logs'
import {
  buildPeerDBAuthHeader,
  type ResolvedPeerDBConfig,
} from '@/lib/peerdb/peerdb-auth'
import {
  PEERDB_CONNECTION_PARAM,
  resolvePeerDBRequestConfig,
} from '@/lib/peerdb/resolve-request-config'
import { resolvePeerDBSweepConcurrency } from '@/lib/peerdb/sweep-pool'

const FALLBACK_FETCH_TIMEOUT_MS = 10_000
/** Wall-clock budget for one request; unread mirrors are reported partial. */
const REQUEST_BUDGET_MS = 25_000
const CACHE_TTL_MS = 30_000
const CACHE_CONTROL = 'private, no-store'

interface CacheEntry {
  at: number
  body: unknown
}
const cache = new Map<string, CacheEntry>()

/** Test hook: clear the in-memory cache between cases. */
export function __clearLogPatternsCache(): void {
  cache.clear()
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

function resolveFetchTimeoutMs(
  bindings: Record<string, string | undefined>
): number {
  const parsed = Math.floor(
    Number((bindings.PEERDB_FETCH_TIMEOUT_MS ?? '').trim())
  )
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : FALLBACK_FETCH_TIMEOUT_MS
}

async function peerdbFetch<T>(
  config: ResolvedPeerDBConfig,
  path: string,
  timeoutMs: number,
  init?: { method: 'GET' | 'POST'; body?: string; signal?: AbortSignal }
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = () => controller.abort()
  init?.signal?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
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
    init?.signal?.removeEventListener('abort', onOuterAbort)
  }
}

function json(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'X-Request-ID': requestId, 'Cache-Control': CACHE_CONTROL },
  })
}

async function handleGet(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  const bindings = env as Record<string, string | undefined>
  const url = new URL(request.url)
  const connectionId = url.searchParams.get(PEERDB_CONNECTION_PARAM)
  const window = parseLogWindow(url.searchParams.get('window'))

  // Resolve + authenticate before touching the cache.
  const config = await resolvePeerDBRequestConfig(request, bindings)
  if (!config) {
    return json(
      {
        success: false,
        error: { message: 'PeerDB is not configured on this deployment' },
        metadata: { queryId: requestId },
      },
      requestId,
      503
    )
  }

  const useCache = connectionId === null
  const cacheKey = `log-patterns:env:${window}`
  if (useCache) {
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return json(hit.body, requestId)
    }
  }

  const timeoutMs = resolveFetchTimeoutMs(bindings)

  let mirrors: string[]
  try {
    const list = await peerdbFetch<ListMirrorsResponse>(
      config,
      '/v1/mirrors/list',
      timeoutMs
    )
    mirrors = (Array.isArray(list?.mirrors) ? list.mirrors : [])
      .map((m) => m?.name)
      .filter((n): n is string => typeof n === 'string' && n !== '')
  } catch (err) {
    return json(
      {
        success: false,
        error: {
          message: err instanceof Error ? err.message : 'PeerDB request failed',
        },
        metadata: { queryId: requestId },
      },
      requestId,
      err instanceof PeerDBError ? err.status : 502
    )
  }

  const data = await collectFleetLogPatterns({
    mirrors,
    window,
    parseTs,
    perMirror: LOG_PATTERNS_PER_MIRROR,
    concurrency: resolvePeerDBSweepConcurrency((n) => bindings[n]),
    budgetMs: REQUEST_BUDGET_MS,
    fetchLogs: async (mirror, signal) =>
      extractMirrorLogs(
        await peerdbFetch<unknown>(config, '/v1/mirrors/logs', timeoutMs, {
          method: 'POST',
          body: JSON.stringify(
            mirrorLogsRequestBody(mirror, 'all', {
              numPerPage: LOG_PATTERNS_PER_MIRROR,
            })
          ),
          signal,
        })
      ),
  })

  const body = {
    success: true,
    data: { ...data, generatedAt: new Date().toISOString() },
    metadata: { queryId: requestId },
  }
  if (useCache) cache.set(cacheKey, { at: Date.now(), body })
  return json(body, requestId)
}

export const Route = createFileRoute('/api/v1/peerdb/log-patterns')({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
    },
  },
})
