/**
 * Tables list endpoint
 * GET /api/v1/tables?hostId=0&limit=500
 *
 * Returns a lightweight list of tables for client-side autocomplete.
 * Excludes system databases and temporary tables.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { ApiErrorType } from '@/lib/api/types'
import type { QueryConfig } from '@/lib/query-config'

import { env } from 'cloudflare:workers'
import { debug, error } from '@chm/logger'
import { executeTableConfig } from '@/lib/api/query-executor'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

/**
 * Autocomplete table-list query. Routed through {@link executeTableConfig} (the
 * same read-only GET path the `/api/v1/tables/$name` and chart routes use) so it
 * resolves the host's ClickHouse version and opts into the query cache via the
 * shared `buildQueryCacheSettings` helper. That matters for correctness, not
 * just caching: on ClickHouse 24.4+ (#2610) a query that touches a `system.*`
 * table fails outright with error 719 the moment `use_query_cache=1` is set
 * unless `query_cache_system_table_handling='save'` is sent — which the shared
 * helper version-gates. This route previously issued a raw `fetchData` call that
 * bypassed that handling, so a host whose default profile enables the query
 * cache 500'd every autocomplete fetch. `refreshInterval` doubles as the cache
 * TTL (see `tableCacheTtlSeconds`).
 */
const TABLES_AUTOCOMPLETE_CONFIG: QueryConfig = {
  name: 'tables-autocomplete',
  refreshInterval: 60_000,
  disableSqlValidation: true,
  sql: `
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
  columns: ['database', 'name', 'engine', 'total_rows'],
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

        const { result } = await executeTableConfig(
          TABLES_AUTOCOMPLETE_CONFIG,
          Number.isFinite(hostId) ? hostId : 0,
          { limit },
          { bindings: env as Record<string, string | undefined> }
        )

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
