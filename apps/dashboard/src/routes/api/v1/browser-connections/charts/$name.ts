/**
 * Chart data via browser connection session or inline credentials.
 * POST /api/v1/browser-connections/charts/$name
 */

import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import { hasChart } from '@/lib/api/chart-registry'
import { createValidationError } from '@/lib/api/error-handler'
import { sanitizeClickHouseError } from '@/lib/api/error-handler/sanitize-error'
import { isValidInterval } from '@/lib/api/query-executor'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { executeConnectionChartQuery } from '@/lib/connection-query/execute-connection-chart'
import { resolveProxyCredentials } from '@/lib/connection-query/resolve-credentials'

const ROUTE_CONTEXT = {
  route: '/api/v1/browser-connections/charts/$name',
  method: 'POST',
} as const

interface ChartProxyBody {
  connection?: { host: string; user: string; password: string }
  sessionToken?: string
  interval?: string
  lastHours?: number
  params?: Record<string, unknown>
  timezone?: string
}

async function handlePost(
  request: Request,
  chartName: string
): Promise<Response> {
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

  let body: Partial<ChartProxyBody>
  try {
    body = (await request.json()) as Partial<ChartProxyBody>
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

  const interval =
    body.interval && isValidInterval(body.interval) ? body.interval : undefined
  const lastHours =
    typeof body.lastHours === 'number' && body.lastHours > 0
      ? body.lastHours
      : undefined

  try {
    const result = await executeConnectionChartQuery(
      chartName,
      credentials,
      {
        interval,
        lastHours,
        params: body.params,
      },
      body.timezone
    )

    return createSuccessResponse(result.data, result.metadata)
  } catch (err) {
    logError(
      '[POST /api/v1/browser-connections/charts/$name] Query failed',
      err
    )
    const rawMessage = err instanceof Error ? err.message : 'Chart query failed'
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
  '/api/v1/browser-connections/charts/$name'
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, params.name),
    },
  },
})
