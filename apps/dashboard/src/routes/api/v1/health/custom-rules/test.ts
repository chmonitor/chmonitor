/**
 * "Test" a whitelisted metric before saving a custom rule (plan 32).
 * GET /api/v1/health/custom-rules/test?metric=<key>&hostId=0
 *
 * Runs the catalog's vetted, read-only SQL for `metric` against one host and
 * returns the raw numeric value — lets the builder show a live preview
 * before the user commits warning/critical thresholds. `metric` is validated
 * against `METRIC_CATALOG`; there is no way to pass arbitrary SQL here.
 */

import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { createSuccessResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { fetchDataWithHost } from '@/lib/clickhouse-helpers'
import {
  assertReadOnlySql,
  METRIC_CATALOG,
} from '@/lib/health/rule-builder-schema'

const ROUTE = { route: '/api/v1/health/custom-rules/test', method: 'GET' }

export const Route = createFileRoute('/api/v1/health/custom-rules/test')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { searchParams } = new URL(request.url)
        const metric = searchParams.get('metric')
        const hostId = Number(searchParams.get('hostId') ?? '0')

        if (!metric || !(metric in METRIC_CATALOG)) {
          return createApiErrorResponse(
            {
              type: ApiErrorType.ValidationError,
              message:
                'Invalid or missing "metric": must be a whitelisted metric key',
            },
            400,
            ROUTE
          )
        }
        if (!Number.isInteger(hostId) || hostId < 0) {
          return createApiErrorResponse(
            { type: ApiErrorType.ValidationError, message: 'Invalid hostId' },
            400,
            ROUTE
          )
        }

        const entry = METRIC_CATALOG[metric as keyof typeof METRIC_CATALOG]
        assertReadOnlySql(entry.sql)

        const result = await fetchDataWithHost<Array<Record<string, unknown>>>({
          query: entry.sql,
          hostId,
          format: 'JSONEachRow',
          clickhouse_settings: { readonly: '1' },
        })

        if (result.error) {
          return createApiErrorResponse(
            { type: ApiErrorType.QueryError, message: result.error.message },
            502,
            ROUTE
          )
        }

        const rows = result.data
        const raw = Array.isArray(rows) ? rows[0]?.[entry.valueKey] : undefined
        const value = raw === null || raw === undefined ? null : Number(raw)

        return createSuccessResponse({
          metric,
          value: Number.isFinite(value) ? value : null,
          unit: entry.unit,
        })
      },
    },
  },
})
