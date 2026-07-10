/**
 * Cluster count API endpoint
 * GET /api/v1/cluster-counts/$key
 *
 * Returns the count for a specific cluster metric based on a pre-defined query.
 * Queries use clusterAllReplicas() to aggregate data across all nodes.
 *
 * SECURITY: No raw SQL is accepted from clients.
 * Only countKey identifiers are used to look up pre-defined queries.
 *
 * Required parameters:
 * - key (path): Count key from cluster-count-registry
 * - cluster (query): Cluster name to query
 * - hostId (query): Host to execute the query on
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error, generateRequestId } from '@chm/logger'
import {
  getClusterCountQuery,
  hasClusterCountKey,
} from '@/lib/api/cluster-count-registry'
import { createErrorResponse } from '@/lib/api/error-handler'
import { HostIdSchema, MenuCountKeySchema } from '@/lib/api/schemas'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'

const ROUTE_CONTEXT = { route: '/api/v1/cluster-counts/$key', method: 'GET' }

interface ClusterCountResponse {
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
      error(
        '[GET /api/v1/cluster-counts] Invalid count key format:',
        countKey,
        { requestId }
      )
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
    if (!hasClusterCountKey(countKey)) {
      error(
        '[GET /api/v1/cluster-counts] Count key not registered:',
        undefined,
        { requestId, countKey }
      )
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

    // Validate cluster parameter (required for cluster counts)
    const cluster = searchParams.get('cluster')
    if (!cluster || cluster.trim() === '') {
      error(
        '[GET /api/v1/cluster-counts] Missing cluster parameter',
        undefined,
        { requestId, countKey }
      )
      const errorResponse = createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'cluster parameter is required',
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

    // Validate hostId parameter
    const hostIdResult = HostIdSchema.safeParse(
      searchParams.get('hostId') ?? '0'
    )
    if (!hostIdResult.success) {
      error(
        '[GET /api/v1/cluster-counts] Invalid hostId parameter',
        undefined,
        { requestId, countKey }
      )
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

    // Cloud demo-hiding invariant (#2172 / #2488): reject a non-negative
    // hostId for an authenticated cloud principal (the hidden env/demo host).
    if (
      await isDemoHostBlockedForRequest(
        hostId,
        env as Record<string, string | undefined>
      )
    ) {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      headers.set('X-Request-ID', requestId)
      return Response.json(
        {
          success: true,
          data: { count: null } satisfies ClusterCountResponse,
          metadata: {
            queryId: `cluster-count-${countKey}`,
            duration: 0,
            rows: 0,
            host: String(hostId),
            unavailable: demoHiddenUnavailable(),
          },
        },
        { headers }
      )
    }

    debug('[GET /api/v1/cluster-counts] Fetching count', {
      requestId,
      countKey,
      cluster,
      hostId,
    })

    // Get the pre-defined query from registry
    const clusterCount = getClusterCountQuery(countKey)
    if (!clusterCount) {
      error('[GET /api/v1/cluster-counts] Count query not found:', undefined, {
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

    // Execute the query with cluster parameter
    const result = await fetchData({
      query: clusterCount.query,
      format: 'JSONEachRow',
      hostId,
      query_params: { cluster },
    })

    // Handle errors - for optional tables, return null count
    if (result.error) {
      if (clusterCount.optional) {
        debug('[GET /api/v1/cluster-counts] Optional table not found:', {
          requestId,
          countKey,
        })

        const response = createSuccessResponse<ClusterCountResponse>(
          { count: null },
          { queryId: `cluster-count-${countKey}`, rows: 1 }
        )
        const headers = new Headers(response.headers)
        headers.set('X-Request-ID', requestId)
        headers.set('Cache-Control', CacheControl.SHORT)
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      error('[GET /api/v1/cluster-counts] Query error:', undefined, {
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

    debug('[GET /api/v1/cluster-counts] Count result:', {
      requestId,
      countKey,
      cluster,
      count,
    })

    const response = createSuccessResponse<ClusterCountResponse>(
      { count },
      { queryId: `cluster-count-${countKey}`, rows: 1 }
    )
    const headers = new Headers(response.headers)
    headers.set('X-Request-ID', requestId)
    headers.set('Cache-Control', CacheControl.SHORT)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (err) {
    error('[GET /api/v1/cluster-counts] Unexpected error:', err, { requestId })
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

export const Route = createFileRoute('/api/v1/cluster-counts/$key')({
  server: {
    handlers: {
      GET: ({ request, params }) => handler(request, params),
    },
  },
})
