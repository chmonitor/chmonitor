/**
 * Explorer skip indexes endpoint
 * GET /api/v1/explorer/skip-indexes?hostId=0&database=default&table=users
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { debug, error } from '@chm/logger'
import { executeTableConfig } from '@/lib/api/query-executor'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { getTableQuery } from '@/lib/api/table-registry'
import { ApiErrorType } from '@/lib/api/types'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

export const Route = createFileRoute('/api/v1/explorer/skip-indexes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const { searchParams } = new URL(request.url)

        const hostIdRaw = searchParams.get('hostId')
        if (hostIdRaw === null || hostIdRaw === '') {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message: 'Missing required parameter: hostId',
              },
            },
            { status: 400 }
          )
        }
        const hostId = Number(hostIdRaw)
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message: `Invalid hostId: ${hostIdRaw}`,
              },
            },
            { status: 400 }
          )
        }

        // Cloud demo-hiding invariant (#2172): user connections always use
        // negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. No-op for OSS and
        // anonymous cloud callers (both legitimately use hostId=0).
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
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

        debug('[GET /api/v1/explorer/skip-indexes]', { hostId })

        const searchParamsObj: Record<string, string> = {}
        searchParams.forEach((value, key) => {
          if (key !== 'hostId') searchParamsObj[key] = value
        })

        const queryDef = getTableQuery('explorer-skip-indexes', {
          hostId,
          searchParams: searchParamsObj,
        })

        if (!queryDef) {
          error('[GET /api/v1/explorer/skip-indexes] Failed to build query')
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.QueryError,
                message: 'Failed to build query for explorer-skip-indexes',
              },
            },
            { status: 500 }
          )
        }

        const { result } = await executeTableConfig(
          queryDef.queryConfig,
          hostId,
          queryDef.queryParams,
          { bindings }
        )

        if (result.error) {
          error(
            '[GET /api/v1/explorer/skip-indexes] Query error:',
            result.error
          )
          const statusMap: Record<string, number> = {
            [ApiErrorType.ValidationError]: 400,
            [ApiErrorType.PermissionError]: 403,
            [ApiErrorType.TableNotFound]: 404,
            [ApiErrorType.NetworkError]: 503,
            [ApiErrorType.QueryError]: 500,
            [ApiErrorType.SslError]: 503,
            [ApiErrorType.TimeoutError]: 504,
          }
          return Response.json(
            {
              success: false,
              error: {
                type: result.error.type,
                message: result.error.message,
                details: result.error.details,
              },
            },
            { status: statusMap[result.error.type] ?? 500 }
          )
        }

        return Response.json(
          {
            success: true,
            data: result.data,
            metadata: {
              queryId: String(result.metadata.queryId ?? ''),
              duration: Number(result.metadata.duration ?? 0),
              rows: Number(result.metadata.rows ?? 0),
              host: String(result.metadata.host ?? ''),
            },
          },
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
            },
          }
        )
      },
    },
  },
})
