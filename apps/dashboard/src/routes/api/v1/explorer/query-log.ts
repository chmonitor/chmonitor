/**
 * Explorer query-log lookup endpoint
 * GET /api/v1/explorer/query-log?hostId=0&queryId=<uuid>
 *
 * Returns the system.query_log row for a previously executed query, used by the
 * SQL Console "Query Log" and "Analysis" tabs. query_log is flushed
 * asynchronously by ClickHouse, so the row may not exist immediately after a
 * query finishes — callers should retry. A 200 with `data: null` means
 * "not found yet" (vs. an error).
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { error } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { ApiErrorType } from '@/lib/api/types'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

// Columns available across supported ClickHouse versions (>= 22.8). Version
// -specific columns (e.g. `projections`) are intentionally omitted; projection
// usage is derived from EXPLAIN indexes=1 in the Analysis tab instead.
const QUERY_LOG_SQL = `
  SELECT
    query_id,
    query,
    type,
    event_time,
    query_duration_ms,
    read_rows,
    read_bytes,
    written_rows,
    written_bytes,
    result_rows,
    result_bytes,
    memory_usage,
    query_kind,
    databases,
    tables,
    columns,
    exception_code,
    exception,
    ProfileEvents
  FROM system.query_log
  WHERE query_id = {queryId:String}
    AND type != 'QueryStart'
  ORDER BY event_time DESC
  LIMIT 1
`

export const Route = createFileRoute('/api/v1/explorer/query-log')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const { searchParams } = new URL(request.url)
        const hostIdRaw = searchParams.get('hostId')
        const queryId = searchParams.get('queryId') ?? ''

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
            data: null,
            metadata: {
              queryId: '',
              found: false,
              unavailable: {
                reason: 'demo_hidden',
                message: 'The demo host is hidden for signed-in accounts.',
              },
            },
          })
        }

        if (!queryId) {
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.ValidationError,
                message: 'Missing required parameter: queryId',
              },
            },
            { status: 400 }
          )
        }

        try {
          const clickhouse_settings: Record<string, string | number> = {
            readonly: 1,
          }
          const result = await fetchData<Record<string, unknown>[]>({
            query: QUERY_LOG_SQL,
            query_params: { queryId },
            hostId,
            format: 'JSONEachRow',
            clickhouse_settings,
          })

          if (result.error) {
            error('[GET /api/v1/explorer/query-log] Query error:', result.error)
            return Response.json(
              {
                success: false,
                error: {
                  type: result.error.type,
                  message: result.error.message,
                  details: result.error.details,
                },
              },
              { status: 503 }
            )
          }

          const row = (result.data ?? [])[0] ?? null
          return Response.json(
            {
              success: true,
              data: row,
              metadata: {
                queryId: String(result.metadata.queryId ?? ''),
                found: row !== null,
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
        } catch (err) {
          error('[GET /api/v1/explorer/query-log] Unexpected error:', err)
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.QueryError,
                message:
                  err instanceof Error ? err.message : 'Unexpected error',
              },
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
