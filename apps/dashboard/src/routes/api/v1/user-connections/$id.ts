/**
 * User connection by ID
 * PATCH  /api/v1/user-connections/$id
 * DELETE /api/v1/user-connections/$id
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { logSessionEvent } from '@/lib/audit/log-session-event'
import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'
import { emitEvent } from '@/lib/events/outbound-bus'

const ROUTE_PATCH = {
  route: '/api/v1/user-connections/$id',
  method: 'PATCH',
}
const ROUTE_DELETE = {
  route: '/api/v1/user-connections/$id',
  method: 'DELETE',
}

async function handlePatch(
  request: Request,
  connectionId: string
): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_PATCH
    )
  }

  let body: Partial<{
    name: string
    host: string
    user: string
    password: string
  }>
  try {
    body = (await request.json()) as typeof body
  } catch {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_PATCH
    )
  }

  if (body.host) {
    const ssrfError = await validateHostUrl(body.host.trim())
    if (ssrfError) {
      return createApiErrorResponse(
        { type: ApiErrorType.ValidationError, message: ssrfError },
        400,
        ROUTE_PATCH
      )
    }
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    const hasCredentialUpdate =
      typeof body.password === 'string' &&
      body.password.length > 0 &&
      Boolean(body.host?.trim()) &&
      Boolean(body.user?.trim())

    const updated = await store.update(userId, connectionId, {
      name: body.name?.trim(),
      hostUrl: body.host?.trim(),
      chUser: body.user?.trim(),
      credentials: hasCredentialUpdate
        ? {
            host: body.host!.trim(),
            user: body.user!.trim(),
            password: body.password!,
          }
        : undefined,
    })

    await logSessionEvent({
      userId,
      event: 'connection.updated',
      resource: updated.id,
      action: 'update',
      result: 'success',
    })

    return createSuccessResponse({
      id: updated.id,
      name: updated.name,
      host: updated.hostUrl,
      user: updated.chUser,
      hostId: updated.hostId,
      engine: updated.engine,
      source: 'database' as const,
      updatedAt: updated.updatedAt,
    })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_PATCH)
  }
}

async function handleDelete(connectionId: string): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_DELETE
    )
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    // Fetch metadata BEFORE delete purely so the emitted event can name which
    // connection was removed — `store.delete()` returns void and the row is
    // gone afterward. NOT_FOUND still throws from delete() below either way.
    const existing = await store.get(userId, connectionId)
    await store.delete(userId, connectionId)

    await logSessionEvent({
      userId,
      event: 'connection.deleted',
      resource: connectionId,
      action: 'delete',
      result: 'success',
    })

    // Outbound webhook bus (plan 44): fire-and-forget, never blocks/fails
    // this request — see lib/events/outbound-bus.ts's module docblock.
    void emitEvent(userId, {
      id: crypto.randomUUID(),
      type: 'connection.deleted',
      occurred_at: new Date().toISOString(),
      data: {
        id: connectionId,
        name: existing?.name,
        hostId: existing?.hostId,
      },
    })

    return createSuccessResponse({ deleted: true })
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_DELETE)
  }
}

export const Route = createFileRoute('/api/v1/user-connections/$id')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => handlePatch(request, params.id),
      DELETE: async ({ params }) => handleDelete(params.id),
    },
  },
})

// Exported for unit tests only.
export {
  handlePatch as __handlePatchForTests,
  handleDelete as __handleDeleteForTests,
}
