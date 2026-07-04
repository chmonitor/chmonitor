/**
 * Menu count API endpoint
 * GET /api/v1/menu-counts/$key
 *
 * Returns the count for a specific menu item based on a pre-defined query.
 * This endpoint only accepts whitelisted count keys to prevent SQL injection.
 *
 * SECURITY: No raw SQL is accepted from clients.
 * Only countKey identifiers are used to look up pre-defined queries.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { getClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import { debug, error, generateRequestId } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/error-handler'
import {
  getMenuCountQuery,
  hasMenuCountKey,
} from '@/lib/api/menu-count-registry'
import { buildQueryCacheSettings } from '@/lib/api/query-cache-settings'
import { HostIdSchema, MenuCountKeySchema } from '@/lib/api/schemas'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'

const ROUTE_CONTEXT = { route: '/api/v1/menu-counts/$key', method: 'GET' }

/**
 * TTL (seconds) for the ClickHouse query cache on menu-count queries (#2182)
 * — mirrors the `CacheControl.MEDIUM` (60s) header this route already sets.
 */
const MENU_COUNT_CACHE_TTL_SECONDS = 60

interface MenuCountResponse {
  readonly count: number | null
}

async function handler(
  request: Request,
  params: { key: string }
): Promise<Response> {
  const requestId = generateRequestId()

  try {
    const countKey = params.key
    const url = new URL(request.url)
    const searchParams = url.searchParams

    // Validate count key format
    const countKeyResult = MenuCountKeySchema.safeParse(countKey)
    if (!countKeyResult.success) {
      error('[GET /api/v1/menu-counts] Invalid count key format:', countKey, {
        requestId,
      })
      const errorResponse = createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: `Invalid count key format: ${countKey}`,
        },
        400,
        ROUTE_CONTEXT
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }

    // Validate count key exists in registry
    if (!hasMenuCountKey(countKey)) {
      error('[GET /api/v1/menu-counts] Count key not registered:', undefined, {
        requestId,
        countKey,
      })
      const errorResponse = createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: `Count key not found: ${countKey}`,
        },
        404,
        ROUTE_CONTEXT
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }

    // Validate hostId parameter
    const hostIdResult = HostIdSchema.safeParse(
      searchParams.get('hostId') ?? '0'
    )
    if (!hostIdResult.success) {
      error('[GET /api/v1/menu-counts] Invalid hostId parameter', undefined, {
        requestId,
        countKey,
      })
      const errorResponse = createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid hostId parameter: must be a non-negative integer',
        },
        400,
        ROUTE_CONTEXT
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }

    const hostId = hostIdResult.data

    debug('[GET /api/v1/menu-counts] Fetching count', {
      requestId,
      countKey,
      hostId,
    })

    // Get the pre-defined query from registry
    const menuCount = getMenuCountQuery(countKey)
    if (!menuCount) {
      error('[GET /api/v1/menu-counts] Count query not found:', undefined, {
        requestId,
        countKey,
      })
      const errorResponse = createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: `Count key not found in registry: ${countKey}`,
        },
        404,
        ROUTE_CONTEXT
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }

    bridgeClickHouseEnv(env as Record<string, string | undefined>)

    // Read-only GET path: safe to opt into the ClickHouse query cache
    // (#2182). getClickHouseVersion caches per host for 24h, so this is
    // cheap; buildQueryCacheSettings fails closed on an unknown version.
    const cacheSettings = buildQueryCacheSettings({
      version: await getClickHouseVersion(hostId),
      ttlSeconds: MENU_COUNT_CACHE_TTL_SECONDS,
      disabled: menuCount.disableQueryCache,
    })

    // Execute the query
    const result = await fetchData({
      query: menuCount.query,
      format: 'JSONEachRow',
      hostId,
      clickhouse_settings: cacheSettings,
    })

    // Handle errors - for optional tables, return null count only when the
    // table genuinely does not exist. Other failures (permissions, timeouts,
    // connectivity, query errors) must surface so the badge isn't silently wrong.
    if (result.error) {
      if (
        menuCount.optional &&
        result.error.type === ApiErrorType.TableNotFound
      ) {
        debug('[GET /api/v1/menu-counts] Optional table not found:', {
          requestId,
          countKey,
        })

        const response = createSuccessResponse<MenuCountResponse>(
          { count: null },
          { queryId: `menu-count-${countKey}`, rows: 1 }
        )
        const headers = new Headers(response.headers)
        headers.set('X-Request-ID', requestId)
        headers.set('Cache-Control', CacheControl.MEDIUM)
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      error('[GET /api/v1/menu-counts] Query error:', undefined, {
        requestId,
        countKey,
        error: result.error.message,
      })
      const errorResponse = createErrorResponse(
        {
          type: result.error.type as ApiErrorType,
          message: result.error.message,
        },
        500,
        { ...ROUTE_CONTEXT, hostId }
      )
      const headers = new Headers(errorResponse.headers)
      headers.set('X-Request-ID', requestId)
      return new Response(errorResponse.body, {
        status: errorResponse.status,
        statusText: errorResponse.statusText,
        headers,
      })
    }

    // Extract count from result
    const data = result.data as Array<{ count?: number | string }>
    const count =
      data.length > 0 && data[0].count !== undefined
        ? Number(data[0].count)
        : null

    debug('[GET /api/v1/menu-counts] Count result:', {
      requestId,
      countKey,
      count,
    })

    const response = createSuccessResponse<MenuCountResponse>(
      { count },
      { queryId: `menu-count-${countKey}`, rows: 1 }
    )
    const headers = new Headers(response.headers)
    headers.set('X-Request-ID', requestId)
    headers.set('Cache-Control', CacheControl.MEDIUM)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (err) {
    error('[GET /api/v1/menu-counts] Unexpected error:', err, { requestId })
    const errorResponse = createErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
      ROUTE_CONTEXT
    )
    const headers = new Headers(errorResponse.headers)
    headers.set('X-Request-ID', requestId)
    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers,
    })
  }
}

export const Route = createFileRoute('/api/v1/menu-counts/$key')({
  server: {
    handlers: {
      GET: ({ request, params }) => handler(request, params),
    },
  },
})
