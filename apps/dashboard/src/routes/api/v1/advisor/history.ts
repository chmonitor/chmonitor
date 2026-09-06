/**
 * Query-history picker endpoint for the Query Advisor page.
 * GET /api/v1/advisor/history?hostId=0&keyword=...&user=...&kind=all&minDurationMs=1000&hours=24&limit=50
 * GET /api/v1/advisor/history?hostId=0&facet=users
 *
 * Read-only browse of `system.query_log` so the advisor input can be populated
 * by picking an existing query. All user input is bound as ClickHouse
 * `{param:Type}` parameters via {@link buildHistoryPickerQuery} — never
 * interpolated into SQL. Runs in `readonly` mode. `facet=users` returns the
 * DISTINCT-user list used to populate the user filter.
 *
 * Anonymous cloud + OSS callers may use hostId=0 (the env/demo host). Signed-in
 * cloud callers get a structured `demo_hidden` empty payload for non-negative
 * ids — the client must surface that, not render a blank list.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { error } from '@chm/logger'
import {
  buildHistoryPickerQuery,
  buildHistoryUsersQuery,
  HISTORY_PICKER_KIND_ALL,
  HISTORY_PICKER_KINDS,
  type HistoryPickerFilters,
  type HistoryPickerKind,
  type HistoryPickerKindFilter,
  type HistoryQueryRow,
} from '@/lib/ai/advisor/history-picker'
import { sanitizeDbQueryError } from '@/lib/api/error-handler/sanitize-error'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { ApiErrorType } from '@/lib/api/types'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'

const ROUTE_CONTEXT = { route: '/api/v1/advisor/history' }

function validationError(message: string): Response {
  return Response.json(
    {
      success: false,
      error: { type: ApiErrorType.ValidationError, message },
      ...ROUTE_CONTEXT,
    },
    { status: 400 }
  )
}

function parseHostId(raw: string | null): number | { message: string } {
  if (raw === null || raw === '') {
    return { message: 'Missing required parameter: hostId' }
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    return { message: `Invalid hostId: ${raw}` }
  }
  return n
}

function parseIntParam(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function parseKind(
  raw: string | null
): HistoryPickerKindFilter | { message: string } {
  if (!raw || raw === HISTORY_PICKER_KIND_ALL || raw === '__all__') {
    return HISTORY_PICKER_KIND_ALL
  }
  return HISTORY_PICKER_KINDS.includes(raw as HistoryPickerKind)
    ? (raw as HistoryPickerKind)
    : { message: `Invalid kind: ${raw}` }
}

function parseIncludeSelf(raw: string | null): boolean {
  if (raw === null || raw.trim() === '') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function demoHiddenResponse(): Response {
  return Response.json({
    success: true,
    data: [],
    metadata: {
      unavailable: demoHiddenUnavailable(),
    },
  })
}

export const Route = createFileRoute('/api/v1/advisor/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        const { searchParams } = new URL(request.url)

        const hostIdResult = parseHostId(searchParams.get('hostId'))
        if (typeof hostIdResult !== 'number') {
          return validationError(hostIdResult.message)
        }
        const hostId = hostIdResult

        // Cloud demo-hiding invariant (#2172 / #2488): user connections always
        // use negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. No-op for OSS and
        // anonymous cloud callers (both legitimately use hostId=0).
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
          return demoHiddenResponse()
        }

        const facet = searchParams.get('facet')
        const kindResult = parseKind(searchParams.get('kind'))
        if (typeof kindResult === 'object') {
          return validationError(kindResult.message)
        }

        const { sql, params } =
          facet === 'users'
            ? buildHistoryUsersQuery(parseIntParam(searchParams.get('hours')))
            : buildHistoryPickerQuery({
                keyword: searchParams.get('keyword') ?? undefined,
                user: searchParams.get('user') ?? undefined,
                kind: kindResult,
                minDurationMs: parseIntParam(searchParams.get('minDurationMs')),
                hours: parseIntParam(searchParams.get('hours')),
                limit: parseIntParam(searchParams.get('limit')),
                excludeSelf: !parseIncludeSelf(searchParams.get('includeSelf')),
              } satisfies HistoryPickerFilters)

        try {
          const clickhouse_settings: Record<string, string | number> = {
            readonly: '1',
          }
          const result = await fetchData<Record<string, unknown>[]>({
            query: sql,
            query_params: params,
            hostId,
            format: 'JSONEachRow',
            clickhouse_settings,
          })

          if (result.error) {
            error('[GET /api/v1/advisor/history] Query error:', result.error)
            return Response.json(
              {
                success: false,
                error: {
                  type: result.error.type,
                  message: sanitizeDbQueryError(result.error.message),
                  details: result.error.details,
                },
                ...ROUTE_CONTEXT,
              },
              { status: 503 }
            )
          }

          const rows = result.data ?? []
          const data =
            facet === 'users'
              ? rows.map((r) => String(r.user ?? '')).filter((u) => u !== '')
              : (rows as unknown as HistoryQueryRow[])

          return Response.json(
            { success: true, data, ...ROUTE_CONTEXT },
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'private, max-age=0',
              },
            }
          )
        } catch (err) {
          error('[GET /api/v1/advisor/history] Unexpected error:', err)
          return Response.json(
            {
              success: false,
              error: {
                type: ApiErrorType.QueryError,
                message:
                  err instanceof Error ? err.message : 'Unexpected error',
              },
              ...ROUTE_CONTEXT,
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
