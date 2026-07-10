/**
 * Batched Table Availability API endpoint
 * GET /api/v1/table-availability?hostId=<n>
 *
 * Returns a map of every ClickHouse system table referenced in the menu to its
 * availability status (boolean) on the current host in a single request, so the
 * sidebar can dim/mute optional features whose system tables are not configured.
 *
 * SECURITY: only table checks declared in menu.ts are executed. Per-route
 * feature-permission gating is centralized in the request middleware (#1397);
 * this route no longer authorizes per-table (the previous `isTableAuthorized`
 * path), so it now reports availability for every menu-referenced table.
 */
import { createFileRoute } from '@tanstack/react-router'
import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { env } from 'cloudflare:workers'
import { checkTableExists } from '@chm/clickhouse-client/table-existence-cache'
import { debug, error, generateRequestId } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/error-handler'
import { HostIdSchema } from '@/lib/api/schemas'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'

const ROUTE_CONTEXT = { route: '/api/v1/table-availability', method: 'GET' }

interface TableAvailabilityResponse {
  readonly available: Record<string, boolean>
}

/** Extracts all unique table checks declared in the menu items. */
function extractTableChecks(items: readonly MenuItem[]): string[] {
  const tables = new Set<string>()

  function recurse(menuItems: readonly MenuItem[]) {
    for (const item of menuItems) {
      if (item.tableCheck) {
        const itemTables = Array.isArray(item.tableCheck)
          ? item.tableCheck
          : [item.tableCheck]
        for (const t of itemTables) {
          tables.add(t)
        }
      }
      if (item.items) {
        recurse(item.items)
      }
    }
  }

  recurse(items)
  return Array.from(tables)
}

/** Resolves a single table check to its availability status. */
async function resolveTableAvailability(
  table: string,
  hostId: number,
  requestId: string
): Promise<boolean | undefined> {
  // Parse database and table names
  const parts = table.split('.')
  const db = parts.length > 1 ? parts[0] : 'system'
  const tbl = parts.length > 1 ? parts[1] : parts[0]

  try {
    const result = await checkTableExists(hostId, db, tbl)
    // 'unknown' = the probe itself failed (network/timeout/auth), not a
    // confirmed answer — omit from the map, same as the catch below.
    return result === 'unknown' ? undefined : result
  } catch (err) {
    error('[GET /api/v1/table-availability] Check table error:', err, {
      requestId,
      table,
      hostId,
    })
    return undefined // Omit from map — preserves client fail-open
  }
}

export const Route = createFileRoute('/api/v1/table-availability')({
  server: {
    handlers: {
      GET: async ({ request }): Promise<Response> => {
        const requestId = generateRequestId()

        try {
          const searchParams = new URL(request.url).searchParams

          // Validate hostId parameter
          const hostIdResult = HostIdSchema.safeParse(
            searchParams.get('hostId') ?? '0'
          )
          if (!hostIdResult.success) {
            error(
              '[GET /api/v1/table-availability] Invalid hostId parameter',
              undefined,
              { requestId }
            )
            const errorResponse = createErrorResponse(
              {
                type: ApiErrorType.ValidationError,
                message:
                  'Invalid hostId parameter: must be a non-negative integer',
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
          bridgeClickHouseEnv(env as Record<string, string | undefined>)

          debug(
            '[GET /api/v1/table-availability] Fetching table availability',
            {
              requestId,
              hostId,
            }
          )

          const tables = extractTableChecks(menuItemsConfig)
          const resolved = await Promise.all(
            tables.map(async (table) => {
              const available = await resolveTableAvailability(
                table,
                hostId,
                requestId
              )
              return [table, available] as const
            })
          )

          const available: Record<string, boolean> = {}
          for (const [table, status] of resolved) {
            if (status !== undefined) {
              available[table] = status
            }
          }

          debug(
            '[GET /api/v1/table-availability] Batched availability result:',
            {
              requestId,
              tablesToCheck: tables.length,
              availableTablesCount: Object.keys(available).length,
            }
          )

          const response = createSuccessResponse<TableAvailabilityResponse>(
            { available },
            {
              queryId: 'table-availability-batch',
              rows: Object.keys(available).length,
            }
          )

          const headers = new Headers(response.headers)
          headers.set('X-Request-ID', requestId)
          // Table existence is slow-changing and anonymous — short edge cache.
          headers.set('Cache-Control', CacheControl.MEDIUM)

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          })
        } catch (err) {
          error('[GET /api/v1/table-availability] Unexpected error:', err, {
            requestId,
          })
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
      },
    },
  },
})
