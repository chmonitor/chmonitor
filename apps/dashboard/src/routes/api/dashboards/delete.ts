/**
 * DELETE /api/dashboards/delete?name=... - Delete the caller's dashboard by
 * name. Owner-scoped: the DELETE statement filters on `owner_id AND name`,
 * so this can never affect another owner's row regardless of what `name` is
 * supplied.
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

const ROUTE_CONTEXT = { route: '/api/dashboards/delete', method: 'DELETE' }

async function handleDelete(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  debug('[DELETE /api/dashboards/delete] Deleting dashboard', { requestId })

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
    debug('[DELETE /api/dashboards/delete] Owner resolved', {
      ownerId,
      requestId,
    })

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
        ROUTE_CONTEXT
      )
    }

    const store = new D1DashboardStore()
    const existing = await store.get(ownerId, name)
    if (!existing) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Dashboard not found',
          details: { timestamp: new Date().toISOString(), name },
        },
        404,
        ROUTE_CONTEXT
      )
    }

    await store.delete(ownerId, name)

    const response = createSuccessResponse(
      { deleted: true, name },
      { queryId: 'dashboard-delete', rows: 1 }
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
    error('[DELETE /api/dashboards/delete] Error:', err, { requestId })

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

export const Route = createFileRoute('/api/dashboards/delete')({
  server: {
    handlers: {
      DELETE: ({ request }) => handleDelete(request),
    },
  },
})
