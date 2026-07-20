/**
 * GET /api/dashboards/list - List the signed-in owner's saved dashboards.
 *
 * Mirrors the guard/response shape of `routes/api/v1/conversations.ts`
 * (feature-flag check → resolve owner → resolve store → respond), reusing
 * the same `conversationDb` flag (see `lib/dashboard-storage/index.ts` for
 * why a dedicated flag isn't needed).
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

const ROUTE_CONTEXT = { route: '/api/dashboards/list', method: 'GET' }

async function handleGet(): Promise<Response> {
  const requestId = generateRequestId()
  debug('[GET /api/dashboards/list] Listing dashboards', { requestId })

  try {
    await autoMigrate()

    if (!isFeatureEnabled('conversationDb')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: 'Dashboard storage is not enabled.',
          details: { timestamp: new Date().toISOString() },
        },
        501,
        ROUTE_CONTEXT
      )
    }

    const ownerId = await resolveDashboardOwnerId()
    debug('[GET /api/dashboards/list] Owner resolved', { ownerId, requestId })

    const store = await resolveDashboardStore()
    const dashboards = await store.list(ownerId)

    const responseData = dashboards.map((d) => ({
      name: d.name,
      layout: d.layout,
    }))

    const response = createSuccessResponse(
      { dashboards: responseData },
      { queryId: 'dashboards-list', rows: responseData.length }
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
    error('[GET /api/dashboards/list] Error:', err, { requestId })

    if (err instanceof DashboardStoreError && err.code === 'UNAUTHORIZED') {
      return createApiErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        403,
        ROUTE_CONTEXT
      )
    }

    return createInternalErrorResponse(err, ROUTE_CONTEXT, requestId)
  }
}

export const Route = createFileRoute('/api/dashboards/list')({
  server: {
    handlers: {
      GET: () => handleGet(),
    },
  },
})
