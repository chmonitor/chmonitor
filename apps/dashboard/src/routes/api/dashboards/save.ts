/**
 * POST /api/dashboards/save - Create or overwrite the caller's dashboard by
 * name (matches the pre-D1 localStorage "same name overwrites" behavior).
 *
 * The request body carries only `{ name, layout }` — never an `id`. The
 * dashboard's internal `id` is resolved/minted server-side
 * (`D1DashboardStore.saveByName`, owner-scoped), so there is no
 * client-supplied identifier for an attacker to collide with another
 * owner's row.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { DashboardLayout } from '@/types/dashboard-layout'

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
import { D1DashboardStore } from '@/lib/dashboard-storage/d1-store'
import { DashboardStoreError } from '@/lib/dashboard-storage/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { autoMigrate } from '@/lib/migration/auto-migrate'
import { normalizeLayout } from '@/types/dashboard-layout'

const ROUTE_CONTEXT = { route: '/api/dashboards/save', method: 'POST' }

interface SaveDashboardRequest {
  name?: unknown
  layout?: unknown
}

function validateBody(
  body: SaveDashboardRequest
): { name: string; layout: DashboardLayout } | { error: string } {
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return { error: 'Invalid field: name must be a non-empty string' }
  }
  if (
    !body.layout ||
    typeof body.layout !== 'object' ||
    !Array.isArray((body.layout as { widgets?: unknown }).widgets)
  ) {
    return {
      error:
        'Invalid field: layout must be a DashboardLayout ({ widgets: [] })',
    }
  }
  // normalizeLayout drops individually-invalid widgets rather than
  // rejecting the whole save — matches the fail-open convention used
  // everywhere else this shape is parsed (d1-store.ts, local-store.ts).
  return { name: body.name, layout: normalizeLayout(body.layout) }
}

async function handlePost(request: Request): Promise<Response> {
  const requestId = generateRequestId()
  debug('[POST /api/dashboards/save] Saving dashboard', { requestId })

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
    debug('[POST /api/dashboards/save] Owner resolved', {
      ownerId,
      requestId,
    })

    const body = (await request.json()) as SaveDashboardRequest
    const validated = validateBody(body)
    if ('error' in validated) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: validated.error,
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT
      )
    }

    const store = new D1DashboardStore()
    const saved = await store.saveByName(
      ownerId,
      validated.name,
      validated.layout
    )

    const response = createSuccessResponse(
      { name: saved.name, layout: saved.layout },
      { queryId: 'dashboard-save', rows: 1 },
      200
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
    error('[POST /api/dashboards/save] Error:', err, { requestId })

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

    if (err instanceof SyntaxError && err.message.includes('JSON')) {
      return createApiErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid JSON in request body',
          details: { timestamp: new Date().toISOString() },
        },
        400,
        ROUTE_CONTEXT
      )
    }

    return createInternalErrorResponse(err, ROUTE_CONTEXT, requestId)
  }
}

export const Route = createFileRoute('/api/dashboards/save')({
  server: {
    handlers: {
      POST: ({ request }) => handlePost(request),
    },
  },
})
