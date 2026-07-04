/**
 * Explorer preview endpoint
 * GET /api/v1/explorer/preview?hostId=0&database=default&table=users&limit=100
 *
 * Returns preview data (SELECT *) from a table with pagination.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { ApiErrorType } from '@/lib/api/types'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

// Validation regex for identifiers (database and table names)
const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const MAX_CELL_VALUE_LENGTH = 10_000

function truncateLargeValues<T>(data: T): T {
  if (!Array.isArray(data)) return data
  return data.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      return row
    const truncated: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value === 'string' && value.length > MAX_CELL_VALUE_LENGTH) {
        truncated[key] =
          value.slice(0, MAX_CELL_VALUE_LENGTH) +
          `… (truncated, ${value.length} chars total)`
      } else {
        truncated[key] = value
      }
    }
    return truncated
  }) as T
}

function mapErrorTypeToStatusCode(errorType: string): number {
  const statusMap: Record<string, number> = {
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

export const Route = createFileRoute('/api/v1/explorer/preview')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const { searchParams } = new URL(request.url)

        // Validate hostId
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

        const database = searchParams.get('database')
        const table = searchParams.get('table')
        const limit = searchParams.get('limit') ?? '100'
        const offset = searchParams.get('offset') ?? '0'

        debug('[GET /api/v1/explorer/preview]', {
          hostId,
          database,
          table,
          limit,
          offset,
        })

        if (!database || !VALID_IDENTIFIER.test(database)) {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message: 'Invalid database identifier',
                details: { database: database ?? 'missing' },
              },
            },
            { status: 400 }
          )
        }

        if (!table || !VALID_IDENTIFIER.test(table)) {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message: 'Invalid table identifier',
                details: { table: table ?? 'missing' },
              },
            },
            { status: 400 }
          )
        }

        const parsedLimit = parseInt(limit, 10)
        if (
          Number.isNaN(parsedLimit) ||
          parsedLimit < 1 ||
          parsedLimit > 10000
        ) {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message:
                  'Invalid limit parameter (must be between 1 and 10000)',
                details: { limit },
              },
            },
            { status: 400 }
          )
        }

        const parsedOffset = parseInt(offset, 10)
        if (
          Number.isNaN(parsedOffset) ||
          parsedOffset < 0 ||
          parsedOffset > 10000
        ) {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message:
                  'Invalid offset parameter (must be a non-negative integer and <= 10000)',
                details: { offset },
              },
            },
            { status: 400 }
          )
        }

        const query =
          'SELECT * FROM {database:Identifier}.{table:Identifier} LIMIT {limit:UInt32} OFFSET {offset:UInt32}'

        debug('[GET /api/v1/explorer/preview] Executing query:', { query })

        const result = await fetchData({
          query,
          query_params: {
            database,
            table,
            limit: parsedLimit,
            offset: parsedOffset,
          },
          hostId,
          format: 'JSONEachRow',
        })

        if (result.error) {
          error('[GET /api/v1/explorer/preview] Query error:', result.error)
          return Response.json(
            {
              success: false,
              error: {
                type: result.error.type,
                message: result.error.message,
                details: result.error.details,
              },
            },
            { status: mapErrorTypeToStatusCode(result.error.type) }
          )
        }

        const truncatedData = truncateLargeValues(result.data)

        return Response.json(
          {
            success: true,
            data: truncatedData,
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
              'Cache-Control': 'private, max-age=0',
            },
          }
        )
      },
    },
  },
})
