/**
 * POST   /api/dashboards/share        - Enable read-only sharing (owner-scoped).
 * DELETE /api/dashboards/share?name=  - Revoke read-only sharing (owner-scoped).
 *
 * Both operations require authentication and only ever act on the caller's
 * own dashboard (`D1DashboardStore.setSharing` reads/writes are owner-scoped).
 * The actual anonymous read lives at the separate `share/$slug` route, which
 * takes no auth and is intentionally a different file — keeping the
 * authenticated mint/revoke path and the public read path unmixed.
 */

import { createFileRoute } from '@tanstack/react-router'

import { debug, error, generateRequestId } from '@chm/logger'
import {
  createErrorResponse as createApiErrorResponse,
  createInternalErrorResponse,
} from '@/lib/api/error-handler'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveDashboardOwnerId } from '@/lib/dashboard-storage/auth'
import { resolveDashboardStore } from '@/lib/dashboard-storage/resolve-server-store'
import { DashboardStoreError } from '@/lib/dashboard-storage/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'

const ROUTE_CONTEXT_POST = { route: '/api/dashboards/share', method: 'POST' }
const ROUTE_CONTEXT_DELETE = {
  route: '/api/dashboards/share',
  method: 'DELETE',
}

function featureDisabledResponse(context: {
  route: string
  method: string
}): Response {
  return createApiErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message: 'Dashboard storage is not enabled.',
      details: { timestamp: new Date().toISOString() },
    },
    501,
    context
  )
}

function notFoundResponse(
  name: string,
  context: { route: string; method: string }
): Response {
  return createApiErrorResponse(
    {
      type: ApiErrorType.ValidationError,
      message: 'Dashboard not found',
      details: { timestamp: new Date().toISOString(), name },
    },
    404,
    context
  )
}

function storeErrorResponse(
  err: DashboardStoreError,
  context: { route: string; method: string }
): Response {
  if (err.code === 'UNAUTHORIZED') {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: err.message,
        details: { timestamp: new Date().toISOString() },
      },
      403,
      context
    )
  }
  return createInternalErrorResponse(err, context)
}

/** Enable read-only sharing; returns the (idempotent) public share slug. */
async function handlePost(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  debug('[POST /api/dashboards/share] Enabling sharing', { requestId })

  try {
    await autoMigrate()

    if (!isFeatureEnabled('conversationDb')) {
      return featureDisabledResponse(ROUTE_CONTEXT_POST)
    }

    const ownerId = await resolveDashboardOwnerId()

    const body = (await request.json()) as { name?: unknown }
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid field: name must be a non-empty string',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_POST
      )
    }

    const store = await resolveDashboardStore()
    const updated = await store.setSharing(ownerId, body.name, true)
    if (!updated) {
      return notFoundResponse(body.name, ROUTE_CONTEXT_POST)
    }

    const response = createSuccessResponse(
      { name: updated.name, shareSlug: updated.shareSlug },
      { queryId: 'dashboard-share-enable', rows: 1 }
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
    error('[POST /api/dashboards/share] Error:', err, { requestId })
    if (err instanceof DashboardStoreError) {
      return storeErrorResponse(err, ROUTE_CONTEXT_POST)
    }
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid JSON in request body',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_POST
      )
    }
    return createInternalErrorResponse(err, ROUTE_CONTEXT_POST, requestId)
  }
}

/** Revoke read-only sharing. */
async function handleDelete(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  debug('[DELETE /api/dashboards/share] Revoking sharing', { requestId })

  try {
    await autoMigrate()

    if (!isFeatureEnabled('conversationDb')) {
      return featureDisabledResponse(ROUTE_CONTEXT_DELETE)
    }

    const ownerId = await resolveDashboardOwnerId()

    const url = new URL(request.url)
    const name = url.searchParams.get('name')
    if (!name) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Missing required query parameter: name',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT_DELETE
      )
    }

    const store = await resolveDashboardStore()
    const updated = await store.setSharing(ownerId, name, false)
    if (!updated) {
      return notFoundResponse(name, ROUTE_CONTEXT_DELETE)
    }

    const response = createSuccessResponse(
      { name: updated.name, shared: false },
      { queryId: 'dashboard-share-revoke', rows: 1 }
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
    error('[DELETE /api/dashboards/share] Error:', err, { requestId })
    if (err instanceof DashboardStoreError) {
      return storeErrorResponse(err, ROUTE_CONTEXT_DELETE)
    }
    return createInternalErrorResponse(err, ROUTE_CONTEXT_DELETE, requestId)
  }
}

export const Route = createFileRoute('/api/dashboards/share')({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
      DELETE: ({ request }) => handleDelete(request),
    },
  },
})
