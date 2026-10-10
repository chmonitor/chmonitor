/**
 * Table data via browser connection session or inline credentials.
 * POST /api/v1/browser-connections/tables/$name
 */

import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import { createValidationError } from '@/lib/api/error-handler'
import { sanitizeClickHouseError } from '@/lib/api/error-handler/sanitize-error'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { executeConnectionTableConfig } from '@/lib/connection-query/execute-connection-table'
import { resolveProxyCredentials } from '@/lib/connection-query/resolve-credentials'
import { getQueryConfigByName } from '@/lib/query-config'
import { ensurePacksLoaded } from '@/lib/query-config/declarative/pack-registry'

const ROUTE_CONTEXT = {
  route: '/api/v1/browser-connections/tables/$name',
  method: 'POST',
} as const

interface TableProxyBody {
  connection?: { host: string; user: string; password: string }
  sessionToken?: string
  searchParams?: Record<string, string | number | boolean>
  timezone?: string
}

async function handlePost(
  request: Request,
  tableName: string
): Promise<Response> {
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

  let body: Partial<TableProxyBody>
  try {
    body = (await request.json()) as Partial<TableProxyBody>
  } catch {
    return createValidationError(
      'Request body must be valid JSON',
      ROUTE_CONTEXT
    )
  }

  const credentials = await resolveProxyCredentials(
    { connection: body.connection, sessionToken: body.sessionToken },
    null
  )
  if (!credentials) {
    return createValidationError(
      'Missing required field: connection or sessionToken',
      ROUTE_CONTEXT
    )
  }

  try {
    const result = await executeConnectionTableConfig(
      queryConfig,
      credentials,
      body.searchParams,
      body.timezone
    )
    return createSuccessResponse(result.data, result.metadata)
  } catch (err) {
    logError(
      '[POST /api/v1/browser-connections/tables/$name] Query failed',
      err
    )
    const rawMessage = err instanceof Error ? err.message : 'Table query failed'
    return createErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: sanitizeClickHouseError(rawMessage),
      },
      500,
      ROUTE_CONTEXT
    )
  }
}

export const Route = createFileRoute(
  '/api/v1/browser-connections/tables/$name'
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, params.name),
    },
  },
})
