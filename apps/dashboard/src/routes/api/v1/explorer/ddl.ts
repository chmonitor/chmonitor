/**
 * Explorer DDL endpoint
 * GET /api/v1/explorer/ddl?hostId=0&database=default&table=users
 */

import { createFileRoute } from '@tanstack/react-router'

import type { ApiResponse } from '@/lib/api/types'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { getHostIdFromParams, type RouteContext } from '@/lib/api/error-handler'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { getTableQuery } from '@/lib/api/table-registry'
import { ApiErrorType } from '@/lib/api/types'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

const ROUTE = '/api/v1/explorer/ddl'

function mapErrorTypeToStatusCode(errorType: ApiErrorType): number {
  const statusMap: Record<ApiErrorType, number> = {
    [ApiErrorType.ValidationError]: 400,
    [ApiErrorType.PermissionError]: 403,
    [ApiErrorType.TableNotFound]: 404,
    [ApiErrorType.NetworkError]: 503,
    [ApiErrorType.QueryError]: 500,
    [ApiErrorType.SslError]: 503,
    [ApiErrorType.TimeoutError]: 504,
  }
  return statusMap[errorType] ?? 500
}

function createSuccessResponse<T>(
  data: T,
  metadata: Record<string, string | number>
): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
    metadata: {
      queryId: String(metadata.queryId || ''),
      duration: Number(metadata.duration || 0),
      rows: Number(metadata.rows || 0),
      host: String(metadata.host || ''),
    },
  }
  return Response.json(response, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  })
}

export const Route = createFileRoute('/api/v1/explorer/ddl')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const { searchParams } = new URL(request.url)
        const routeContext: RouteContext = { route: ROUTE, method: 'GET' }

        const hostId = getHostIdFromParams(searchParams, routeContext)

        // Cloud demo-hiding invariant (#2172): user connections always use
        // negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. No-op for OSS and
        // anonymous cloud callers (both legitimately use hostId=0).
        const numericHostId =
          typeof hostId === 'number' ? hostId : Number(hostId)
        if (await isDemoHostBlockedForRequest(numericHostId, bindings)) {
          return Response.json({
            success: true,
            data: [],
            metadata: {
              queryId: '',
              duration: 0,
              rows: 0,
              host: String(hostId),
              unavailable: {
                reason: 'demo_hidden',
                message: 'The demo host is hidden for signed-in accounts.',
              },
            },
          })
        }

        debug(`[GET ${ROUTE}]`, { hostId })

        const searchParamsObj: Record<string, string> = {}
        searchParams.forEach((value, key) => {
          if (key !== 'hostId') searchParamsObj[key] = value
        })

        const queryDef = getTableQuery('explorer-ddl', {
          hostId,
          searchParams: searchParamsObj,
        })

        if (!queryDef) {
          error(`[GET ${ROUTE}] Failed to build query`)
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.QueryError,
                message: 'Failed to build query for explorer-ddl',
              },
            },
            { status: 500 }
          )
        }

        const result = await fetchData({
          query: queryDef.query,
          query_params: queryDef.queryParams,
          hostId,
          format: 'JSONEachRow',
        })

        if (result.error) {
          error(`[GET ${ROUTE}] Query error:`, result.error)
          return Response.json(
            {
              success: false,
              error: {
                type: result.error.type,
                message: result.error.message,
                details: result.error.details,
              },
            },
            {
              status: mapErrorTypeToStatusCode(
                result.error.type as ApiErrorType
              ),
            }
          )
        }

        return createSuccessResponse(result.data, result.metadata)
      },
    },
  },
})
