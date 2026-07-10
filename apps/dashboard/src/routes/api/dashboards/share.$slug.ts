/**
 * GET /api/dashboards/share/$slug - PUBLIC, UNAUTHENTICATED read-only view of
 * a shared dashboard.
 *
 * SECURITY: deliberately takes no auth and performs no owner check — that is
 * the point of a share link. The only guards are:
 *   - `D1DashboardStore.getByShareSlug` queries `WHERE share_slug = ? AND
 *     is_shared = 1` and projects ONLY `{ name, charts }` (see
 *     `d1-store.ts`'s `D1_GET_DASHBOARD_BY_SLUG_SQL`) — never `ownerId`,
 *     `id`, or any other owner-identifying field.
 *   - An unknown OR revoked slug both resolve to a generic 404 — the
 *     response never distinguishes "never existed" from "was revoked" from
 *     "wrong token", so a caller can't use this endpoint to enumerate or
 *     probe dashboard existence.
 *   - `Cache-Control: NONE` — a revoked share must stop resolving
 *     immediately, not after a cached copy expires.
 *   - Rate-limited by client IP (`checkRateLimit`/`getApiRateLimitPerMin`),
 *     the same guard `routes/api/v1/charts/$name.ts` applies to its public
 *     GET route — a defense-in-depth throttle on top of the slug's
 *     `crypto.randomUUID()` entropy, which already makes brute-forcing a
 *     valid slug computationally infeasible.
 *
 * Kept as a separate file/route from `share.ts` (the authenticated
 * mint/revoke endpoint) so the public, unauthenticated surface is never
 * accidentally reachable through a code path that also handles owner auth.
 */

import { createFileRoute } from '@tanstack/react-router'

import { debug, error, generateRequestId } from '@chm/logger'
import {
  createErrorResponse as createApiErrorResponse,
  createInternalErrorResponse,
} from '@/lib/api/error-handler'
import {
  checkRateLimit,
  clientIpKey,
  getApiRateLimitPerMin,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { D1DashboardStore } from '@/lib/dashboard-storage/d1-store'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT = { route: '/api/dashboards/share/$slug', method: 'GET' }

async function handleGet(request: Request, slug: string): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/dashboards/share/$slug] Fetching shared dashboard', {
    requestId,
  })

  // Rate-limit by client IP before doing any work — this is a public,
  // unauthenticated route, so it's the only abuse guard available.
  const ip = clientIpKey(request)
  const rlResult = checkRateLimit(
    `dashboards-share:ip:${ip}`,
    getApiRateLimitPerMin()
  )
  if (!rlResult.allowed) return rateLimitResponse(rlResult.retryAfterSec)

  try {
    await autoMigrate()

    // Sharing is only possible when server-side (D1) storage is enabled —
    // if it's off, no shared dashboard could ever have been minted, so this
    // is a clean "not available" rather than an attempt to reach D1.
    if (!isFeatureEnabled('conversationDb')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Shared dashboard not found.',
          details: { timestamp: new Date().toISOString() },
        },
        404,
        ROUTE_CONTEXT
      )
    }

    if (!slug) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Missing share slug',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT
      )
    }

    const store = new D1DashboardStore()
    const dashboard = await store.getByShareSlug(slug)

    if (!dashboard) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Shared dashboard not found.',
          details: { timestamp: new Date().toISOString() },
        },
        404,
        ROUTE_CONTEXT
      )
    }

    const response = createSuccessResponse(
      { dashboard },
      { queryId: 'dashboard-share-view', rows: 1 }
    )
    const headers = new Headers(response.headers)
    headers.set('X-Request-ID', requestId)
    headers.set('Cache-Control', CacheControl.NONE)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (err) {
    error('[GET /api/dashboards/share/$slug] Error:', err, { requestId })

    return createInternalErrorResponse(err, ROUTE_CONTEXT, requestId)
  }
}

export const Route = createFileRoute('/api/dashboards/share/$slug')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.slug),
    },
  },
})
