/**
 * Tables list endpoint
 * GET /api/v1/tables?hostId=0&limit=500
 *
 * Returns a lightweight list of tables for client-side autocomplete.
 * Excludes system databases and temporary tables.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { ApiErrorType } from '@/lib/api/types'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

interface TableRow {
  database: string
  name: string
  engine: string
  total_rows: string
}

export const Route = createFileRoute('/api/v1/tables/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        const { searchParams } = new URL(request.url)
        const rawHostId = searchParams.get('hostId') ?? '0'
        const hostId = Number.parseInt(rawHostId, 10)

        const rawLimit = searchParams.get('limit')
        const parsedLimit = rawLimit
          ? Number.parseInt(rawLimit, 10)
          : DEFAULT_LIMIT
        const limit =
          Number.isFinite(parsedLimit) && parsedLimit > 0
            ? Math.min(parsedLimit, MAX_LIMIT)
            : DEFAULT_LIMIT

        debug('[GET /api/v1/tables]', { hostId, limit })

        // Cloud demo-hiding invariant (#2172 / #2488): user connections
        // always use negative hostIds, so a non-negative id from a
        // signed-in cloud principal can only be the hidden env/demo host.
        // No-op for OSS and anonymous cloud callers (both legitimately use
        // hostId=0).
        if (
          await isDemoHostBlockedForRequest(
            hostId,
            env as Record<string, string | undefined>
          )
        ) {
          return Response.json({
            success: true,
            data: [],
            metadata: {
              queryId: '',
              duration: 0,
              rows: 0,
              host: String(hostId),
              unavailable: true,
              unavailableReason:
                'The demo host is hidden for signed-in accounts.',
            },
          })
        }

        const result = await fetchData<TableRow[]>({
          query: `
            SELECT
              database,
              name,
              engine,
              toString(total_rows) AS total_rows
            FROM system.tables
            WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
              AND NOT is_temporary
            ORDER BY total_bytes DESC NULLS LAST
            LIMIT {limit: UInt32}
          `,
          query_params: { limit },
          hostId,
          format: 'JSONEachRow',
        })

        if (result.error) {
          error('[GET /api/v1/tables] Query error:', result.error)
          return Response.json(
            {
              success: false,
              metadata: {
                queryId: '',
                duration: 0,
                rows: 0,
                host: String(hostId),
              },
              error: {
                type: result.error.type as ApiErrorType,
                message: result.error.message,
              },
            },
            { status: 500 }
          )
        }

        const rows = result.data ?? []
        return Response.json(
          {
            success: true,
            data: rows,
            metadata: {
              queryId: String(result.metadata.queryId || ''),
              rows: rows.length,
              host: String(result.metadata.host || ''),
            },
          },
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control':
                'public, s-maxage=60, stale-while-revalidate=300',
            },
          }
        )
      },
    },
  },
})
