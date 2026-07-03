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
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { resolveDashboardOwnerId } from '@/lib/dashboard-storage/auth'
import { D1DashboardStore } from '@/lib/dashboard-storage/d1-store'
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

    const store = new D1DashboardStore()
    const dashboards = await store.list(ownerId)

    const responseData = dashboards.map((d) => ({
      name: d.name,
      charts: d.charts,
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
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error occurred'
    error('[GET /api/dashboards/list] Error:', err, { requestId })

    if (err instanceof DashboardStoreError) {
      const status = err.code === 'UNAUTHORIZED' ? 403 : 500
      return createApiErrorResponse(
        {
          type:
            err.code === 'UNAUTHORIZED'
              ? ApiErrorType.PermissionError
              : ApiErrorType.QueryError,
          message: err.message,
          details: { timestamp: new Date().toISOString() },
        },
        status,
        ROUTE_CONTEXT
      )
    }

    return createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: errorMessage,
        details: { timestamp: new Date().toISOString() },
      },
      500,
      ROUTE_CONTEXT
    )
  }
}

export const Route = createFileRoute('/api/dashboards/list')({
  server: {
    handlers: {
      GET: () => handleGet(),
    },
  },
})
