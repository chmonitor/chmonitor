/**
 * Table data via server-stored user connection.
 * POST /api/v1/user-connections/tables/$name
 */

import { createFileRoute } from '@tanstack/react-router'

import { createValidationError } from '@/lib/api/error-handler'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { executeConnectionTableConfig } from '@/lib/connection-query/execute-connection-table'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'
import { getQueryConfigByName } from '@/lib/query-config'
import { ensurePacksLoaded } from '@/lib/query-config/declarative/pack-registry'

const ROUTE_CONTEXT = {
  route: '/api/v1/user-connections/tables/$name',
  method: 'POST',
} as const

interface TableBody {
  connectionId: string
  searchParams?: Record<string, string | number | boolean>
  timezone?: string
}

async function handlePost(
  request: Request,
  tableName: string
): Promise<Response> {
  if (!getUserConnectionsServerConfig().dbStorageEnabled) {
    return createErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'User connections database storage is not enabled.',
      },
      501,
      ROUTE_CONTEXT
    )
  }

  // Community query packs (plan 54) — warm before the sync lookup so a
  // pack-only table name resolves deterministically (no cold-start race).
  await ensurePacksLoaded()
  const queryConfig = getQueryConfigByName(tableName)
  if (!queryConfig) {
    return createErrorResponse(
      {
        type: ApiErrorType.TableNotFound,
        message: `Table query not found: ${tableName}`,
      },
      404,
      ROUTE_CONTEXT
    )
  }

  let body: Partial<TableBody>
  try {
    body = (await request.json()) as Partial<TableBody>
  } catch {
    return createValidationError(
      'Request body must be valid JSON',
      ROUTE_CONTEXT
    )
  }

  if (!body.connectionId) {
    return createValidationError(
      'Missing required field: connectionId',
      ROUTE_CONTEXT
    )
  }

  try {
    const userId = await resolveConnectionUserId()
    const store = await resolveConnectionStore()
    const credentials = await store.getCredentials(userId, body.connectionId)
    if (!credentials) {
      return createErrorResponse(
        {
          type: ApiErrorType.PermissionError,
          message: 'Connection not found',
        },
        404,
        ROUTE_CONTEXT
      )
    }

    const result = await executeConnectionTableConfig(
      queryConfig,
      credentials,
      body.searchParams,
      body.timezone
    )
    return createSuccessResponse(result.data, result.metadata)
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_CONTEXT)
  }
}

export const Route = createFileRoute('/api/v1/user-connections/tables/$name')({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, params.name),
    },
  },
})
