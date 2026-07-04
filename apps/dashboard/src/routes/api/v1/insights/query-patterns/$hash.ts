/**
 * Query Insights — one slow query pattern + its recent executions
 * GET /api/v1/insights/query-patterns/:normalized_query_hash?hostId=0&range=24
 *
 * Reuses the same aggregation as `/api/v1/insights/query-patterns`
 * (buildQueryPatternsSql), scoped to one `normalized_query_hash`, plus the
 * individual `system.query_log` rows behind it (reverse-chronological).
 *
 * Path parameter:
 * - normalized_query_hash: the pattern's hash (numeric string, ClickHouse UInt64)
 *
 * Query parameters:
 * - hostId (optional, default 0): host to run against, non-negative integer
 * - range (optional, default 24): relative window in hours for both the
 *   pattern's aggregation and the executions list
 */
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import {
  buildPatternDetailConfig,
  buildPatternExecutionsConfig,
  isValidQueryHash,
  parseRangeHours,
} from '@/lib/api/insights/query-patterns'
import { executeTableConfig } from '@/lib/api/query-executor'

/** Cap on individual executions returned per pattern. */
const EXECUTIONS_LIMIT = 200

export async function handler(
  request: Request,
  hash: string
): Promise<Response> {
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

  if (!isValidQueryHash(hash)) {
    return Response.json(
      {
        success: false,
        error: {
          type: 'validation',
          message: 'Invalid normalized_query_hash: must be a numeric string',
        },
      },
      { status: 400 }
    )
  }

  const rangeHours = parseRangeHours(searchParams.get('range'))
  const queryParams = {
    normalized_query_hash: hash,
    range_hours: rangeHours,
    executions_limit: EXECUTIONS_LIMIT,
  }

  try {
    const [patternExec, executionsExec] = await Promise.all([
      executeTableConfig(buildPatternDetailConfig(), hostId, queryParams, {
        bindings,
      }),
      executeTableConfig(buildPatternExecutionsConfig(), hostId, queryParams, {
        bindings,
      }),
    ])

    if (patternExec.result.error) {
      return Response.json(
        {
          success: false,
          error: {
            type: 'query_error',
            message: patternExec.result.error.message,
            details: patternExec.result.error.details,
          },
        },
        { status: 500 }
      )
    }
    if (executionsExec.result.error) {
      return Response.json(
        {
          success: false,
          error: {
            type: 'query_error',
            message: executionsExec.result.error.message,
            details: executionsExec.result.error.details,
          },
        },
        { status: 500 }
      )
    }

    const pattern = (patternExec.result.data ?? [])[0]
    if (!pattern) {
      return Response.json(
        {
          success: false,
          error: {
            type: 'not_found',
            message: `No slow-query pattern found for normalized_query_hash=${hash} in the last ${rangeHours}h`,
          },
        },
        { status: 404 }
      )
    }

    const executions = executionsExec.result.data ?? []

    return Response.json(
      {
        success: true,
        data: { pattern, executions },
        metadata: {
          queryId: String(patternExec.result.metadata.queryId || ''),
          duration:
            Number(patternExec.result.metadata.duration || 0) +
            Number(executionsExec.result.metadata.duration || 0),
          rows: executions.length,
          host: String(hostId),
          rangeHours,
          sql: `${patternExec.executedSql.trim()}\n\n${executionsExec.executedSql.trim()}`,
          clickhouseVersion: patternExec.clickhouseVersion,
        },
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (err) {
    error(
      `[GET /api/v1/insights/query-patterns/${hash}] Unhandled exception:`,
      err
    )
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

export const Route = createFileRoute('/api/v1/insights/query-patterns/$hash')({
  server: {
    handlers: {
      GET: ({ request, params }) => handler(request, params.hash),
    },
  },
})
