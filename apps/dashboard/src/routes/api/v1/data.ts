/**
 * Generic data endpoint for executing ClickHouse queries
 * POST /api/v1/data, GET /api/v1/data
 *
 * Accepts a query and parameters, returns data with metadata.
 * Includes caching headers for performance optimization.
 *
 * SECURITY: queries run here are either:
 * 1. A registered QueryConfig named by `queryConfigName` (POST only). The
 *    server builds the SQL from the config and enforces the config's feature
 *    permission; client SQL is not accepted in this mode.
 * 2. Stored in the dashboard tables (for Chart Builder), checked by
 *    validateDashboardQuery. No feature permission applies; the global API
 *    auth guard (lib/auth/api-guard.ts) is the only auth gate.
 * Custom SQL belongs on /api/v1/explorer/query (explorer query permission).
 *
 * Ported from apps/dashboard/app/api/v1/data/route.ts.
 * - Error handling and request validation reuse the shared
 *   @/lib/api/error-handler and @/lib/api/shared/validators modules. Only the
 *   route-specific success-response builder and the FetchDataError→status
 *   mapping (handleQueryError) remain local.
 */

import { createFileRoute } from '@tanstack/react-router'
import type { DataFormat } from '@clickhouse/client'

import type { FetchDataError } from '@chm/clickhouse-client'
import type { ApiRequest, ApiResponse } from '@/lib/api/types'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { getClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import { debug, error } from '@chm/logger'
import { validateSqlQuery } from '@chm/sql-builder'
import { validateDashboardQuery } from '@/lib/api/data/dashboard-query-validator'
import {
  createErrorResponse as createApiErrorResponse,
  createValidationError,
  getStatusCodeForErrorType as mapErrorTypeToStatusCode,
  withApiHandler,
} from '@/lib/api/error-handler'
import { sanitizeDbQueryError } from '@/lib/api/error-handler/sanitize-error'
import { executeTableConfig } from '@/lib/api/query-executor'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  getAndValidateHostId,
  validateDataRequest,
  validateFormat,
  validateHostIdWithError,
  validateSearchParams,
} from '@/lib/api/shared/validators'
import { getTableConfig, getTableQuery } from '@/lib/api/table-registry'
import { ApiErrorType } from '@/lib/api/types'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

const ROUTE_CONTEXT = { route: '/api/v1/data' } as const

// ---------------------------------------------------------------------------
// Route-specific success response builder.
// ---------------------------------------------------------------------------

const SUCCESS_CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
} as const

function createSuccessResponse<T>(
  data: T,
  meta?: {
    readonly queryId?: string | number
    readonly duration?: number
    readonly rows?: number
    readonly sql?: string
    readonly timezone?: string
    readonly [key: string]: unknown
  }
): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
    metadata: {
      queryId: meta?.queryId != null ? String(meta.queryId) : '',
      duration: meta?.duration != null ? Number(meta.duration) : 0,
      rows: meta?.rows != null ? Number(meta.rows) : 0,
      host: '',
      ...(meta?.sql && { sql: String(meta.sql) }),
      ...(meta?.timezone && { timezone: String(meta.timezone) }),
    },
  }

  return Response.json(response, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...SUCCESS_CACHE_HEADERS,
    },
  })
}

/**
 * Cloud demo-hiding invariant (#2172 / #2488): user connections always use
 * negative hostIds, so a non-negative id from a signed-in cloud principal can
 * only be the hidden env/demo host. No-op for OSS and anonymous cloud callers
 * (both legitimately use hostId=0).
 */
function createDemoHiddenResponse(hostId: number): Response {
  return Response.json({
    success: true,
    data: null,
    metadata: {
      queryId: '',
      duration: 0,
      rows: 0,
      host: String(hostId),
      unavailable: demoHiddenUnavailable(),
    },
  })
}

/**
 * Handle query execution errors with proper status code mapping
 */
function handleQueryError(
  queryError: FetchDataError,
  hostId: string | number,
  method: string
): Response {
  const errorTypeMap: Record<FetchDataError['type'], ApiErrorType> = {
    table_not_found: ApiErrorType.TableNotFound,
    column_not_found: ApiErrorType.ColumnNotFound,
    validation_error: ApiErrorType.ValidationError,
    query_error: ApiErrorType.QueryError,
    network_error: ApiErrorType.NetworkError,
    permission_error: ApiErrorType.PermissionError,
    ssl_error: ApiErrorType.SslError,
    timeout_error: ApiErrorType.TimeoutError,
  }

  const apiErrorType = errorTypeMap[queryError.type] ?? ApiErrorType.QueryError

  return createApiErrorResponse(
    {
      type: apiErrorType,
      message: sanitizeDbQueryError(queryError.message),
      details: queryError.details as Record<
        string,
        string | number | boolean | undefined
      >,
    },
    mapErrorTypeToStatusCode(apiErrorType),
    { ...ROUTE_CONTEXT, method, hostId }
  )
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Handle GET requests for data fetching
 * Accepts query and parameters via URL query string
 *
 * @example
 * GET /api/v1/data?hostId=0&sql=SELECT%20count()%20FROM%20system.tables&format=JSONEachRow
 */
const handleGet = withApiHandler(async (request: Request) => {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  const url = new URL(request.url)
  const searchParams = url.searchParams

  // Parse query parameters from URL
  const query =
    searchParams.get('sql') || searchParams.get('query') || undefined
  const format = searchParams.get('format') as DataFormat | null
  const timezone = searchParams.get('timezone') || undefined

  // Validate required parameters
  const validationError = validateSearchParams(searchParams, ['hostId'])
  if (validationError) {
    return createValidationError(validationError.message, {
      ...ROUTE_CONTEXT,
      method: 'GET',
    })
  }

  if (!query) {
    return createValidationError('Missing required parameter: sql or query', {
      ...ROUTE_CONTEXT,
      method: 'GET',
    })
  }

  // SECURITY: Validate SQL query to prevent injection attacks
  try {
    validateSqlQuery(query)
  } catch (validationErr) {
    error('[GET /api/v1/data] Security: SQL validation failed', {
      queryPreview: query.substring(0, 100),
      error:
        validationErr instanceof Error
          ? validationErr.message
          : 'Unknown error',
    })
    return createValidationError(
      validationErr instanceof Error
        ? validationErr.message
        : 'SQL validation failed',
      { ...ROUTE_CONTEXT, method: 'GET' }
    )
  }

  // Get and validate hostId from search params
  const hostIdResult = getAndValidateHostId(searchParams)
  if (typeof hostIdResult !== 'number') {
    return createValidationError(hostIdResult.message, {
      ...ROUTE_CONTEXT,
      method: 'GET',
    })
  }
  const hostId = hostIdResult

  if (
    await isDemoHostBlockedForRequest(
      hostId,
      env as Record<string, string | undefined>
    )
  ) {
    return createDemoHiddenResponse(hostId)
  }

  debug('[GET /api/v1/data]', {
    hostId,
    format: format || 'JSONEachRow',
    timezone,
  })

  // SECURITY: Validate GET query against dashboard allowlist to prevent
  // arbitrary SQL execution through query-string requests.
  const validationResult = await validateDashboardQuery(query, hostId)
  if (!validationResult.valid) {
    error('[GET /api/v1/data] Security: Query not found in dashboard tables', {
      queryPreview: query.substring(0, 100),
    })
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: validationResult.error?.message || 'Query validation failed',
      },
      403,
      { ...ROUTE_CONTEXT, method: 'GET', hostId }
    )
  }

  // Execute the query
  const result = await fetchData({
    query,
    format: (format || 'JSONEachRow') as DataFormat,
    hostId,
    // SECURITY: Enforce readonly mode to prevent DML/DDL even if SQL validation is bypassed
    clickhouse_settings: {
      readonly: '1',
      ...(timezone ? { session_timezone: timezone } : {}),
    },
  })

  // Handle errors
  if (result.error) {
    error('[GET /api/v1/data] Query error:', result.error)
    return handleQueryError(result.error, hostId, 'GET')
  }

  // Create successful response with timezone in metadata
  return createSuccessResponse(result.data, { ...result.metadata, timezone })
}, ROUTE_CONTEXT)

/**
 * Run a named, registered QueryConfig for POST /api/v1/data.
 *
 * The SQL always comes from the server-side config: the registry resolves it
 * (filterSchema WHERE injection, defaultParams + body params) and
 * executeTableConfig picks the versioned SQL for the host's ClickHouse version,
 * exactly like GET /api/v1/tables/$name. Body `queryParams` only ever reach
 * ClickHouse as bound `query_params`. The config's own feature permission gates
 * the request.
 *
 * A body that carries both `queryConfigName` and `query` is rejected (400)
 * rather than silently ignoring `query`: the server cannot reliably compare a
 * client string with versioned / filter-injected SQL, and a client that sends
 * both is either buggy or should be calling /api/v1/explorer/query (which is
 * gated by the explorer query permission) for custom SQL.
 */
async function handleNamedConfigPost(
  request: Request,
  body: Partial<ApiRequest>,
  queryConfigName: string
): Promise<Response> {
  const context = { ...ROUTE_CONTEXT, method: 'POST' }

  if (body.query !== undefined) {
    return createValidationError(
      'Send either queryConfigName or query, not both. A named query always runs its own SQL; use /api/v1/explorer/query for custom SQL.',
      context
    )
  }

  const hostIdError = validateHostIdWithError(body.hostId)
  if (hostIdError) return createApiErrorResponse(hostIdError, 400, context)
  const formatError = validateFormat(body.format)
  if (formatError) return createApiErrorResponse(formatError, 400, context)
  if (body.format !== undefined && body.format !== 'JSONEachRow') {
    return createValidationError(
      'Named queries only support the JSONEachRow format',
      context
    )
  }

  const hostId = Number(body.hostId)
  if (!Number.isInteger(hostId) || hostId < 0) {
    return createValidationError('Invalid hostId', context)
  }
  const bindings = env as Record<string, string | undefined>

  if (await isDemoHostBlockedForRequest(hostId, bindings)) {
    return createDemoHiddenResponse(hostId)
  }

  const registered = getTableConfig(queryConfigName)
  if (!registered) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.TableNotFound,
        message: `Unknown query config: ${queryConfigName}`,
      },
      404,
      { ...context, hostId }
    )
  }

  const permissionResponse = await authorizeFeatureRequest(
    registered.permission,
    request
  )
  if (permissionResponse) return permissionResponse

  const searchParams: Record<string, string> = {}
  for (const [key, value] of Object.entries(body.queryParams ?? {})) {
    searchParams[key] = String(value)
  }
  const hasGatedFilters = registered.filterSchema?.fields.some((f) => f.since)
  const serverVersion = hasGatedFilters
    ? ((await getClickHouseVersion(hostId))?.raw ?? null)
    : undefined
  const queryDef = getTableQuery(queryConfigName, {
    hostId,
    searchParams,
    serverVersion,
  })
  if (!queryDef) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: `Failed to resolve query config: ${queryConfigName}`,
      },
      500,
      { ...context, hostId }
    )
  }

  const timezone = body.timezone
  const { result, executedSql } = await executeTableConfig(
    queryDef.queryConfig,
    hostId,
    queryDef.queryParams,
    { bindings, timezone }
  )

  if (result.error) {
    error('[POST /api/v1/data] Query error:', result.error)
    return handleQueryError(result.error, hostId, 'POST')
  }

  return createSuccessResponse(result.data, {
    ...result.metadata,
    sql: executedSql,
    timezone,
  })
}

/**
 * Handle POST requests for data fetching
 *
 * Two modes:
 * - `queryConfigName` set: runs only that registered config's SQL (see
 *   {@link handleNamedConfigPost}); a body `query` is rejected.
 * - `query` set (no name): the SQL must match a query saved in the dashboard
 *   tables (validateDashboardQuery, the Chart Builder allowlist). No feature
 *   permission applies to this mode; it is gated only by the global API auth
 *   guard (lib/auth/api-guard.ts) plus that allowlist and readonly=1.
 *
 * @example
 * POST /api/v1/data
 * { "queryConfigName": "query-detail", "queryParams": { "query_id": "abc" }, "hostId": 0 }
 */
export const handlePost = withApiHandler(async (request: Request) => {
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  // Parse request body
  const body = (await request.json()) as Partial<ApiRequest>

  // SECURITY: Reject client-supplied QueryConfig objects to prevent SQL override attacks.
  if (
    typeof body === 'object' &&
    body !== null &&
    'queryConfig' in body &&
    (body as { queryConfig?: unknown }).queryConfig !== undefined
  ) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'queryConfig is not accepted from clients. Use queryConfigName instead.',
      },
      400,
      { ...ROUTE_CONTEXT, method: 'POST' }
    )
  }

  if (body?.queryConfigName !== undefined) {
    if (
      typeof body.queryConfigName !== 'string' ||
      body.queryConfigName.trim() === ''
    ) {
      return createValidationError('queryConfigName must be a string', {
        ...ROUTE_CONTEXT,
        method: 'POST',
      })
    }
    return handleNamedConfigPost(request, body, body.queryConfigName)
  }

  // Validate required fields using shared validator
  const validationError = validateDataRequest(body)
  if (validationError) {
    return createApiErrorResponse(validationError, 400, {
      ...ROUTE_CONTEXT,
      method: 'POST',
    })
  }

  const typedBody = body as ApiRequest
  const {
    query,
    queryParams,
    hostId,
    format = 'JSONEachRow',
    timezone,
  } = typedBody

  debug('[POST /api/v1/data]', {
    hostId,
    format,
    timezone,
  })

  if (
    await isDemoHostBlockedForRequest(
      Number(hostId),
      env as Record<string, string | undefined>
    )
  ) {
    return createDemoHiddenResponse(Number(hostId))
  }

  // SECURITY: Validate SQL query to prevent injection attacks (mirrors GET handler).
  try {
    validateSqlQuery(query)
  } catch (validationErr) {
    error('[POST /api/v1/data] Security: SQL validation failed', {
      queryPreview: query.substring(0, 100),
      error:
        validationErr instanceof Error
          ? validationErr.message
          : 'Unknown error',
    })
    return createValidationError(
      validationErr instanceof Error
        ? validationErr.message
        : 'SQL validation failed',
      { ...ROUTE_CONTEXT, method: 'POST', hostId }
    )
  }

  // SECURITY: the query must exist in the dashboard tables.
  const validationResult = await validateDashboardQuery(query, Number(hostId))
  if (!validationResult.valid) {
    error('[POST /api/v1/data] Security: Query not found in dashboard tables', {
      queryPreview: query.substring(0, 100),
    })
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: validationResult.error?.message || 'Query validation failed',
      },
      403,
      { ...ROUTE_CONTEXT, method: 'POST', hostId }
    )
  }

  // Convert format string to DataFormat if needed
  const dataFormat = (format || 'JSONEachRow') as DataFormat

  // Execute the query
  const result = await fetchData({
    query,
    query_params: queryParams,
    format: dataFormat,
    hostId,
    // SECURITY: Enforce readonly mode to prevent DML/DDL even if SQL validation is bypassed
    clickhouse_settings: {
      readonly: '1',
      ...(timezone ? { session_timezone: timezone } : {}),
    },
  })

  // Handle errors
  if (result.error) {
    error('[POST /api/v1/data] Query error:', result.error)
    return handleQueryError(result.error, hostId, 'POST')
  }

  // Create successful response with timezone in metadata
  return createSuccessResponse(result.data, { ...result.metadata, timezone })
}, ROUTE_CONTEXT)

export const Route = createFileRoute('/api/v1/data')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
      POST: async ({ request }) => handlePost(request),
    },
  },
})
