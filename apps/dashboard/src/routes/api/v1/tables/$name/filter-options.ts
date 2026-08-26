/**
 * Filter options endpoint
 * GET /api/v1/tables/$name/filter-options?hostId=0&key=user
 *
 * Returns the distinct values for a `select` filter field that declares
 * `dynamicOptions`. Table and column come exclusively from the trusted
 * filter schema — the request only supplies the (validated) config name and
 * field key, never raw SQL identifiers.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { QueryConfig } from '@/types/query-config'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { error } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { getTableConfig } from '@/lib/api/table-registry'
import { ApiErrorType } from '@/lib/api/types'
import { sanitizeDbQueryError } from '@/lib/api/error-handler/sanitize-error'

interface FilterOption {
  value: string
  count: number
}

export const Route = createFileRoute('/api/v1/tables/$name/filter-options')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        const { name } = params
        const { searchParams } = new URL(request.url)

        const rawHostId = searchParams.get('hostId') ?? '0'
        const hostId = Number.parseInt(rawHostId, 10)
        const key = searchParams.get('key')

        if (!key) {
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
                type: ApiErrorType.ValidationError,
                message: 'Missing required parameter: key',
              },
            },
            { status: 400 }
          )
        }

        const config = getTableConfig(name) as QueryConfig | undefined
        const field = config?.filterSchema?.fields.find((f) => f.key === key)

        if (!field?.dynamicOptions) {
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
                type: ApiErrorType.ValidationError,
                message: `Filter field "${key}" does not provide dynamic options`,
              },
            },
            { status: 404 }
          )
        }

        const { table, column, where } = field.dynamicOptions
        const whereClause = where
          ? `WHERE ${where} AND notEmpty(toString(${column}))`
          : `WHERE notEmpty(toString(${column}))`
        const sql = `
          ${QUERY_COMMENT}
          SELECT
            ${column} AS value,
            count() AS count
          FROM ${table}
          ${whereClause}
          GROUP BY value
          ORDER BY count DESC
          LIMIT 200`

        const result = await fetchData<FilterOption[]>({
          query: sql,
          hostId,
          format: 'JSONEachRow',
        })

        if (result.error) {
          error(
            `[GET /api/v1/tables/${name}/filter-options] Query error:`,
            result.error
          )
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
                message: sanitizeDbQueryError(result.error.message),
              },
            },
            { status: 500 }
          )
        }

        return Response.json(
          { options: result.data ?? [] },
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control':
                'public, s-maxage=120, stale-while-revalidate=300',
            },
          }
        )
      },
    },
  },
})
