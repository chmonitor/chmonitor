/**
 * Chart data via server-stored user connection.
 * POST /api/v1/user-connections/charts/$name
 */

import { createFileRoute } from '@tanstack/react-router'

import { hasChart } from '@/lib/api/chart-registry'
import { createValidationError } from '@/lib/api/error-handler'
import { isValidInterval } from '@/lib/api/query-executor'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { executeConnectionChartQuery } from '@/lib/connection-query/execute-connection-chart'
import { mapConnectionApiError } from '@/lib/connection-store/api-errors'
import { resolveConnectionUserId } from '@/lib/connection-store/auth'
import { resolveConnectionStore } from '@/lib/connection-store/resolve-store'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'

const ROUTE_CONTEXT = {
  route: '/api/v1/user-connections/charts/$name',
  method: 'POST',
} as const

interface ChartBody {
  connectionId: string
  interval?: string
  lastHours?: number
  params?: Record<string, unknown>
  timezone?: string
}

async function handlePost(
  request: Request,
  chartName: string
): Promise<Response> {
  // Auth before the feature check: an anonymous caller gets 401, never a
  // 501 that reveals how storage is configured (#4013).
  let userId: string
  try {
    userId = await resolveConnectionUserId()
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_CONTEXT)
  }

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

  if (!hasChart(chartName)) {
    return createErrorResponse(
      {
        type: ApiErrorType.TableNotFound,
        message: `Chart not found: ${chartName}`,
      },
      404,
      ROUTE_CONTEXT
    )
  }

  let body: Partial<ChartBody>
  try {
    body = (await request.json()) as Partial<ChartBody>
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

    const interval =
      body.interval && isValidInterval(body.interval)
        ? body.interval
        : undefined
    const lastHours =
      typeof body.lastHours === 'number' && body.lastHours > 0
        ? body.lastHours
        : undefined

    const result = await executeConnectionChartQuery(
      chartName,
      credentials,
      { interval, lastHours, params: body.params },
      body.timezone
    )

    return createSuccessResponse(result.data, result.metadata)
  } catch (error) {
    return mapConnectionApiError(error, ROUTE_CONTEXT)
  }
}

export const Route = createFileRoute('/api/v1/user-connections/charts/$name')({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, params.name),
    },
  },
})
