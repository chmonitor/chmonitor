/**
 * Query Insights — list slow query patterns
 * GET /api/v1/insights/query-patterns?hostId=0&range=24&sort=total_duration:desc
 *
 * Thin wrapper over the `slow-query-patterns` QueryConfig
 * (lib/query-config/queries/slow-query-patterns.ts) via the same
 * table-registry + query-executor path `/api/v1/tables/slow-query-patterns`
 * uses — returns the same aggregated data the Slow Query Patterns page shows.
 *
 * Query parameters:
 * - hostId (optional, default 0): host to run against, non-negative integer
 * - range (optional): relative window in hours, shorthand for the page's
 *   `event_time=withinHours:<hours>` filter (default 24h, same as the page)
 * - sort (optional): `column[:asc|desc]` — re-orders the returned rows by any
 *   column in the response (default: the SQL's `total_duration DESC`)
 * - filter fields (optional): any `slow-query-patterns` filterSchema field —
 *   `user`, `query_kind`, `database`, `event_time` — as `key=operator:value`
 *   (e.g. `user=eq:default`), the same convention the dashboard filter bar
 *   uses (see lib/filters/url-state.ts)
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { sortPatternRows } from '@/lib/api/insights/query-patterns'
import { executeTableConfig } from '@/lib/api/query-executor'
import { getTableQuery } from '@/lib/api/table-registry'

const CONFIG_NAME = 'slow-query-patterns'

export async function handler(request: Request): Promise<Response> {
  const bindings = env as Record<string, string | undefined>
  const { searchParams } = new URL(request.url)

  // Validate hostId. `hostId` is the canonical param
  // (docs/knowledge/api-hostid-validation.md); `host` is accepted too so
  // `?host=` from the issue's shorthand also works.
  const hostIdStr =
    searchParams.get('hostId') ?? searchParams.get('host') ?? '0'
  const hostId = Number(hostIdStr)
  if (!Number.isInteger(hostId) || hostId < 0) {
    return Response.json(
      {
        success: false,
        error: { type: 'validation', message: 'Invalid hostId' },
      },
      { status: 400 }
    )
  }

  // Forward filter fields to the config's filterSchema (event_time, user,
  // query_kind, database). `range` is shorthand for `event_time=withinHours:`.
  const filterParams: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (key === 'hostId' || key === 'host' || key === 'sort' || key === 'range')
      continue
    filterParams[key] = value
  }
  const range = searchParams.get('range')
  if (range && !filterParams.event_time) {
    filterParams.event_time = `withinHours:${range}`
  }

  const queryDef = getTableQuery(CONFIG_NAME, {
    hostId,
    searchParams: filterParams,
  })
  if (!queryDef) {
    error(
      `[GET /api/v1/insights/query-patterns] Missing config: ${CONFIG_NAME}`
    )
    return Response.json(
      {
        success: false,
        error: {
          type: 'query_error',
          message: 'Query patterns config not found',
        },
      },
      { status: 500 }
    )
  }

  try {
    const { result, executedSql, clickhouseVersion } = await executeTableConfig(
      queryDef.queryConfig,
      hostId,
      queryDef.queryParams,
      { bindings }
    )

    if (result.error) {
      return Response.json(
        {
          success: false,
          error: {
            type: 'query_error',
            message: result.error.message,
            details: result.error.details,
          },
        },
        { status: 500 }
      )
    }

    const rows = result.data ?? []
    const sorted = sortPatternRows(rows, searchParams.get('sort'))

    return Response.json(
      {
        success: true,
        data: sorted,
        metadata: {
          queryId: String(result.metadata.queryId || ''),
          duration: Number(result.metadata.duration || 0),
          rows: sorted.length,
          host: String(hostId),
          sql: executedSql.trim(),
          clickhouseVersion,
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (err) {
    error('[GET /api/v1/insights/query-patterns] Unhandled exception:', err)
    return Response.json(
      {
        success: false,
        error: {
          type: 'query_error',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/v1/insights/query-patterns')({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
})
