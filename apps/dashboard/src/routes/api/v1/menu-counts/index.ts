/**
 * Batched menu count API endpoint
 * GET /api/v1/menu-counts?hostId=<n>
 *
 * Returns a map of every registered menu count key to its count in a single
 * request, so the sidebar makes ONE call instead of N independent ones.
 *
 * Optional-table misses resolve to `null`, matching the per-key endpoint's
 * behavior. A query failure on one key resolves that key to `null` rather than
 * failing the whole batch, so a single broken count never blanks out every
 * sidebar badge.
 *
 * SECURITY: No raw SQL is accepted from clients. Only pre-defined registry
 * queries are executed.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { getClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import { debug, error, generateRequestId } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/error-handler'
import {
  getAvailableMenuCountKeys,
  getMenuCountQuery,
} from '@/lib/api/menu-count-registry'
import { buildQueryCacheSettings } from '@/lib/api/query-cache-settings'
import { HostIdSchema } from '@/lib/api/schemas'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  CacheControl,
  createSuccessResponse,
} from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'

const ROUTE_CONTEXT = { route: '/api/v1/menu-counts', method: 'GET' }

/**
 * TTL (seconds) for the ClickHouse query cache on menu-count queries (#2182)
 * — mirrors the `CacheControl.MEDIUM` (60s) header this route already sets.
 */
const MENU_COUNT_CACHE_TTL_SECONDS = 60

interface MenuCountsResponse {
  readonly counts: Record<string, number | null>
}

/**
 * Resolves a single registry key to its count value for the given host.
 *
 * Returns `undefined` when the key has no registered query.
 * Returns `null` when the count is unavailable (optional table missing or
 * query failed). Returns a number otherwise.
 */
async function resolveCount(
  countKey: string,
  hostId: number,
  requestId: string,
  cacheSettings: ReturnType<typeof buildQueryCacheSettings>
): Promise<number | null | undefined> {
  const menuCount = getMenuCountQuery(countKey)
  if (!menuCount) return undefined

  const result = await fetchData({
    query: menuCount.query,
    format: 'JSONEachRow',
    hostId,
    clickhouse_settings: menuCount.disableQueryCache
      ? undefined
      : cacheSettings,
  })

  if (result.error) {
    if (
      menuCount.optional &&
      result.error.type === ApiErrorType.TableNotFound
    ) {
      debug('[GET /api/v1/menu-counts] Optional table not found:', {
        requestId,
        countKey,
      })
      return null
    }

    error('[GET /api/v1/menu-counts] Query error:', undefined, {
      requestId,
      countKey,
      error: result.error.message,
    })
    return null
  }

  const data = result.data as Array<{ count?: number | string }>
  return data.length > 0 && data[0].count !== undefined
    ? Number(data[0].count)
    : null
}

export async function handler(request: Request): Promise<Response> {
  const requestId = generateRequestId()

  try {
    const url = new URL(request.url)
    const searchParams = url.searchParams

    // Validate hostId parameter
    const hostIdResult = HostIdSchema.safeParse(
      searchParams.get('hostId') ?? '0'
    )
    if (!hostIdResult.success) {
      error('[GET /api/v1/menu-counts] Invalid hostId parameter', undefined, {
        requestId,
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

    debug('[GET /api/v1/menu-counts] Fetching batched counts', {
      requestId,
      hostId,
    })

    bridgeClickHouseEnv(env as Record<string, string | undefined>)

    // Read-only GET path: safe to opt into the ClickHouse query cache
    // (#2182). getClickHouseVersion caches per host for 24h, so this is
    // cheap; buildQueryCacheSettings fails closed on an unknown version.
    const cacheSettings = buildQueryCacheSettings({
      version: await getClickHouseVersion(hostId),
      ttlSeconds: MENU_COUNT_CACHE_TTL_SECONDS,
    })

    const keys = getAvailableMenuCountKeys()

    // 1. Query system.tables to check which optional tables exist
    const tablesCheckResult = await fetchData({
      query: `SELECT database, name FROM system.tables WHERE (database = 'system' AND name IN ('distributed_ddl_queue', 'clusters', 'backup_log', 'dictionaries', 'view_refreshes')) OR (name = 'monitoring_events')`,
      format: 'JSONEachRow',
      hostId,
    })

    const existingTables = new Set<string>()
    if (!tablesCheckResult.error && Array.isArray(tablesCheckResult.data)) {
      for (const row of tablesCheckResult.data as Array<{
        database: string
        name: string
      }>) {
        existingTables.add(`${row.database}.${row.name}`)
        existingTables.add(row.name)
      }
    }

    // 2. Build combined subqueries
    const selectSubqueries: string[] = []
    const counts: Record<string, number | null> = {}
    let combinedQueryCacheDisabled = false

    for (const key of keys) {
      const menuCount = getMenuCountQuery(key)
      if (!menuCount) continue

      if (menuCount.optional && menuCount.tableCheck) {
        if (!existingTables.has(menuCount.tableCheck)) {
          // Table doesn't exist: return null without querying it
          counts[key] = null
          continue
        }
      }

      // A single opted-out key disables caching for the whole combined
      // query — there's no way to cache only part of one UNION-of-subqueries
      // SELECT.
      if (menuCount.disableQueryCache) combinedQueryCacheDisabled = true

      // Wrap the registry query as a subquery
      selectSubqueries.push(
        `(SELECT count FROM (${menuCount.query})) AS \`${key}\``
      )
    }

    if (selectSubqueries.length > 0) {
      const combinedQuery = `SELECT ${selectSubqueries.join(', ')}`
      const result = await fetchData({
        query: combinedQuery,
        format: 'JSONEachRow',
        hostId,
        clickhouse_settings: combinedQueryCacheDisabled
          ? undefined
          : cacheSettings,
      })

      if (result.error) {
        // Fall back to original resolveCount loop if the combined query fails
        // (preserves robust error recovery on schema/version mismatches)
        debug(
          '[GET /api/v1/menu-counts] Combined query failed. Falling back to loop.',
          {
            requestId,
            error: result.error.message,
          }
        )
        const resolved = await Promise.all(
          keys.map(async (k) => {
            const val = await resolveCount(k, hostId, requestId, cacheSettings)
            return [k, val] as const
          })
        )
        for (const [k, val] of resolved) {
          if (val !== undefined) counts[k] = val
        }
      } else {
        const data = result.data as Record<string, number | string>[]
        if (data && data.length > 0) {
          const row = data[0]
          for (const key of Object.keys(row)) {
            counts[key] = Number(row[key])
          }
        }
      }
    }

    debug('[GET /api/v1/menu-counts] Batched count result:', {
      requestId,
      keys: Object.keys(counts).length,
    })

    const response = createSuccessResponse<MenuCountsResponse>(
      { counts },
      { queryId: 'menu-counts-batch', rows: Object.keys(counts).length }
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

export const Route = createFileRoute('/api/v1/menu-counts/')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})
