/**
 * Browser Connection Proxy endpoint
 * POST /api/v1/browser-connections/proxy
 *
 * Executes a ClickHouse query using browser-provided connection credentials.
 * Returns results in the same shape as /api/v1/data.
 * Credentials are provided in the request body and never logged.
 *
 * Ported from apps/dashboard/app/api/v1/browser-connections/proxy/route.ts.
 * - Per-route auth (authorizeFeatureRequest) dropped; centralized in middleware (#1397).
 * - NextResponse replaced with standard Response / Response.json.
 * - @/lib/api/error-handler and @/lib/api/shared/response-builder both exist in
 *   this app and are imported directly.
 */

import { createFileRoute } from '@tanstack/react-router'
import type { DataFormat } from '@clickhouse/client'
import { createClient } from '@clickhouse/client-web'

import { validateSqlQuery } from '@chm/sql-builder'
import { createValidationError } from '@/lib/api/error-handler'
import {
  createErrorResponse,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  createHostValidationFetch,
  validateHostUrl,
} from '@/lib/browser-connections/host-url'
import { resolveProxyCredentials } from '@/lib/connection-query/resolve-credentials'

const ROUTE_CONTEXT = {
  route: '/api/v1/browser-connections/proxy',
  method: 'POST',
} as const

interface ProxyConnection {
  host: string
  user: string
  password: string
}

interface ProxyRequest {
  connection?: ProxyConnection
  sessionToken?: string
  query: string
  query_params?: Record<string, string | number | boolean>
  format?: string
}

async function handlePost(request: Request): Promise<Response> {
  let body: Partial<ProxyRequest>
  try {
    body = (await request.json()) as Partial<ProxyRequest>
  } catch {
    return createValidationError(
      'Request body must be valid JSON',
      ROUTE_CONTEXT
    )
  }

  const {
    connection,
    sessionToken,
    query,
    query_params,
    format = 'JSONEachRow',
  } = body

  const resolved = await resolveProxyCredentials(
    { connection, sessionToken },
    null
  )

  if (!resolved) {
    return createValidationError(
      'Missing required field: connection or sessionToken',
      ROUTE_CONTEXT
    )
  }

  const { host, user, password } = resolved

  if (!host || typeof host !== 'string') {
    return createValidationError(
      'Missing required field: connection.host',
      ROUTE_CONTEXT
    )
  }
  if (!user || typeof user !== 'string') {
    return createValidationError(
      'Missing required field: connection.user',
      ROUTE_CONTEXT
    )
  }
  if (typeof password !== 'string') {
    return createValidationError(
      'Missing required field: connection.password',
      ROUTE_CONTEXT
    )
  }
  if (!query || typeof query !== 'string') {
    return createValidationError('Missing required field: query', ROUTE_CONTEXT)
  }

  // SECURITY: Validate SQL query to prevent injection attacks
  try {
    validateSqlQuery(query)
  } catch (validationErr) {
    return createValidationError(
      validationErr instanceof Error
        ? validationErr.message
        : 'SQL validation failed',
      ROUTE_CONTEXT
    )
  }

  // Validate host URL and block SSRF targets
  const ssrfError = await validateHostUrl(host)
  if (ssrfError) {
    return createValidationError(ssrfError, ROUTE_CONTEXT)
  }

  const start = Date.now()

  try {
    const client = createClient({
      host,
      username: user,
      password,
      fetch: createHostValidationFetch(),
    })

    const result = await client.query({
      query,
      query_params,
      format: format as DataFormat,
      // SECURITY: Enforce readonly mode to prevent DML/DDL even if SQL
      // validation is bypassed — defense-in-depth, matching /api/v1/data.
      clickhouse_settings: {
        readonly: '1',
      },
    })

    const rows = await result.json<unknown[]>()
    const duration = Date.now() - start
    const rowCount = Array.isArray(rows) ? rows.length : 0

    return createSuccessResponse(rows, {
      duration,
      rows: rowCount,
      queryId: result.query_id,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Query execution failed'
    return createErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message,
        details: { timestamp: new Date().toISOString() },
      },
      500,
      ROUTE_CONTEXT
    )
  }
}

export const Route = createFileRoute('/api/v1/browser-connections/proxy')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
