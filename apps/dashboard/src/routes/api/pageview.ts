/**
 * PageView Tracking Endpoint — GET /api/pageview
 *
 * Records a PageView event to the monitoring_events table. Collects URL,
 * browser user-agent, and IP/geo from standard request headers.
 *
 * Ported from apps/dashboard/app/api/pageview/route.ts.
 * - next/server (userAgent) and @vercel/functions (geolocation) are replaced
 *   with direct header reads — equivalent for Cloudflare Workers.
 * - ErrorLogger replaced with @chm/logger debug/error.
 *
 * Auth enforced via enforceAuth() (provider-aware; allows anonymous when
 * provider=none, matching Next middleware behaviour from the legacy app).
 *
 * PageView is intentionally reachable by anonymous browsers (that is its whole
 * purpose), so it is NOT locked behind isAuthenticatedRequest(). To stop an
 * anonymous caller from spamming inserts into the events table, the anonymous
 * INSERT is guarded by a best-effort per-IP fixed-window rate limiter.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { clientIpKey } from '@/lib/api/rate-limiter'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { EVENTS_TABLE } from '@/lib/app-tables'
import { bridgeApiKeyEnv, enforceAuth } from '@/lib/auth/api-guard'

/** Trim whitespace and strip trailing slash/question-mark from a URL string. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/(\/|\?)$/, '')
}

// Best-effort in-memory rate limiter. Module scope persists for the lifetime of
// a Worker isolate, so this bounds anonymous insert spam per isolate without any
// external store. Fixed window: at most PAGEVIEW_RATE_LIMIT requests per IP per
// PAGEVIEW_RATE_WINDOW_MS.
const PAGEVIEW_RATE_LIMIT = 30
const PAGEVIEW_RATE_WINDOW_MS = 60_000
const pageviewHits = new Map<string, { count: number; resetAt: number }>()

/** Returns true when this IP is within its allowed request budget. */
function allowPageview(ip: string): boolean {
  const key = ip || 'unknown'
  const now = Date.now()
  const entry = pageviewHits.get(key)

  if (!entry || now >= entry.resetAt) {
    pageviewHits.set(key, { count: 1, resetAt: now + PAGEVIEW_RATE_WINDOW_MS })
    // Opportunistically evict expired entries to bound map growth.
    if (pageviewHits.size > 10_000) {
      for (const [k, v] of pageviewHits) {
        if (now >= v.resetAt) pageviewHits.delete(k)
      }
    }
    return true
  }

  if (entry.count >= PAGEVIEW_RATE_LIMIT) return false
  entry.count += 1
  return true
}

export const Route = createFileRoute('/api/pageview')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)
        bridgeApiKeyEnv(env as Record<string, string | undefined>)

        const authFailure = await enforceAuth(request)
        if (authFailure) return authFailure

        const searchParams = new URL(request.url).searchParams
        const rawUrl = searchParams.get('url') || request.headers.get('referer')
        const hostId = parseInt(searchParams.get('hostId') || '0', 10)
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json({ error: 'Invalid hostId' }, { status: 400 })
        }

        if (!rawUrl) {
          return Response.json({ error: 'No URL provided' }, { status: 400 })
        }

        const url = normalizeUrl(rawUrl)

        // User-agent: parse browser/os/device from the UA string directly.
        // next/server's userAgent() is not available; Cloudflare provides the
        // raw header. We forward the raw string in the extra payload.
        const uaString = request.headers.get('user-agent') ?? ''

        // Geo: Cloudflare Workers expose CF-IPCountry, CF-IPCity etc.
        const country =
          request.headers.get('cf-ipcountry') ??
          request.headers.get('x-vercel-ip-country') ??
          undefined
        const city =
          request.headers.get('cf-ipcity') ??
          request.headers.get('x-vercel-ip-city') ??
          undefined
        const region =
          request.headers.get('cf-region') ??
          request.headers.get('x-vercel-ip-country-region') ??
          undefined

        // Client identity for the rate-limit key and the stored `extra.ip`.
        // Only trusts X-Real-IP / X-Forwarded-For when the runtime allows it
        // (CHM_TRUST_PROXY_HEADERS / CF edge) — see clientIpKey.
        const ip = clientIpKey(
          request,
          env as Record<string, string | undefined>
        )

        // Rate-limit the anonymous-reachable INSERT to prevent event-table spam.
        if (!allowPageview(ip)) {
          return Response.json({ error: 'Too many requests' }, { status: 429 })
        }

        try {
          const client = await getClient({ hostId })
          await client.insert({
            table: EVENTS_TABLE,
            format: 'JSONEachRow',
            values: [
              {
                kind: 'PageView',
                data: url,
                actor: 'user',
                extra: JSON.stringify({
                  userAgent: uaString,
                  ip,
                  city,
                  country,
                  region,
                }),
              },
            ],
          })
          debug('[/api/pageview] PageView event created', { url })
          return Response.json({ message: 'PageView event created', url })
        } catch (err) {
          error('[/api/pageview] PageView insert error', err as Error)
          return Response.json(
            { error: 'Internal server error' },
            { status: 500 }
          )
        }
      },
    },
  },
})
