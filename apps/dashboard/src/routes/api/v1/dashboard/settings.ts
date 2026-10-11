/**
 * Dashboard settings API endpoint
 * GET /api/v1/dashboard/settings - Retrieve dashboard settings
 * POST /api/v1/dashboard/settings - Update dashboard settings
 */

import { createFileRoute } from '@tanstack/react-router'

import type { ApiResponse } from '@/lib/api/types'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { ApiErrorType } from '@/lib/api/types'
import { DASHBOARD_SETTINGS_TABLE } from '@/lib/app-tables'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

const TABLE_SETTINGS = DASHBOARD_SETTINGS_TABLE

const ROUTE_CONTEXT_GET = {
  route: '/api/v1/dashboard/settings',
  method: 'GET',
}
const ROUTE_CONTEXT_POST = {
  route: '/api/v1/dashboard/settings',
  method: 'POST',
}

function isValidHostId(hostId: number): boolean {
  return Number.isInteger(hostId) && hostId >= 0
}

function emptySettingsResponse(
  hostId: number
): ApiResponse<{ params: Record<string, string> }> {
  return {
    success: true,
    data: { params: {} },
    metadata: {
      queryId: 'dashboard-settings-get',
      duration: 0,
      rows: 0,
      host: String(hostId),
    },
  }
}

function isTableMissingError(msg: string): boolean {
  return (
    msg.includes('UNKNOWN_TABLE') ||
    msg.includes('Unknown table expression') ||
    (msg.includes('Table') && msg.includes("doesn't exist"))
  )
}

function makeErrorResponse(
  type: ApiErrorType,
  message: string,
  status: number,
  _context?: { route?: string; method?: string }
): Response {
  return Response.json(
    {
      success: false,
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: 'unknown',
      },
      error: { type, message },
    },
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

export const Route = createFileRoute('/api/v1/dashboard/settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)
        debug('[GET /api/v1/dashboard/settings] Fetching settings')

        const { searchParams } = new URL(request.url)
        const hostId = Number(searchParams.get('hostId') ?? '0')
        if (!isValidHostId(hostId)) {
          return makeErrorResponse(
            ApiErrorType.ValidationError,
            'Invalid hostId: expected a non-negative integer',
            400,
            ROUTE_CONTEXT_GET
          )
        }

        try {
          debug('[GET /api/v1/dashboard/settings]', { hostId })

          const query = `
            SELECT key, value
            FROM ${TABLE_SETTINGS} FINAL
          `

          const client = await getClient({ hostId })
          const resultSet = await client.query({
            query,
            format: 'JSONEachRow',
          })

          const rows = (await resultSet.json()) as unknown as {
            key: string
            value: string
          }[]

          const params = rows.reduce(
            (acc, row) => {
              acc[row.key] = row.value
              return acc
            },
            {} as Record<string, string>
          )

          const response: ApiResponse<{ params: Record<string, string> }> = {
            success: true,
            data: { params },
            metadata: {
              queryId: 'dashboard-settings-get',
              duration: 0,
              rows: rows.length,
              host: String(hostId),
            },
          }

          return Response.json(response, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : 'Unknown error occurred'

          if (isTableMissingError(errorMessage)) {
            debug(
              '[GET /api/v1/dashboard/settings] Settings table missing; returning empty response',
              { hostId }
            )
            return Response.json(emptySettingsResponse(hostId), { status: 200 })
          }

          error('[GET /api/v1/dashboard/settings] Error:', errorMessage)
          return makeErrorResponse(
            ApiErrorType.QueryError,
            errorMessage,
            500,
            ROUTE_CONTEXT_GET
          )
        }
      },

      POST: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        // Write gate: this POST runs `ALTER TABLE ... UPDATE`, a cluster
        // mutation. The global /api/v1 middleware is a public passthrough
        // under provider='none' / CHM_CLERK_PUBLIC_READ, so this route must
        // self-enforce that anonymous callers cannot mutate settings. A valid
        // `chm_` API key still authenticates programmatic clients. Mirrors the
        // /api/v1/actions guard.
        const permissionResponse = await authorizeFeatureRequest(
          {
            feature: 'settings',
            defaultAccess: 'authenticated',
            operation: 'write',
          },
          request,
          { allowAgentBearerToken: true }
        )
        if (permissionResponse) return permissionResponse

        debug('[POST /api/v1/dashboard/settings] Updating settings')

        try {
          let body: {
            params?: Record<string, string>
            hostId?: number | string
          }
          try {
            body = (await request.json()) as typeof body
          } catch {
            return makeErrorResponse(
              ApiErrorType.ValidationError,
              'Invalid JSON body',
              400,
              ROUTE_CONTEXT_POST
            )
          }
          const { params, hostId = 0 } = body
          const parsedHostId = Number(hostId)

          if (!params || typeof params !== 'object' || Array.isArray(params)) {
            return makeErrorResponse(
              ApiErrorType.ValidationError,
              'Missing or invalid field: params',
              400,
              ROUTE_CONTEXT_POST
            )
          }
          if (!isValidHostId(parsedHostId)) {
            return makeErrorResponse(
              ApiErrorType.ValidationError,
              'Invalid hostId: expected a non-negative integer',
              400,
              ROUTE_CONTEXT_POST
            )
          }

          debug('[POST /api/v1/dashboard/settings]', {
            hostId: parsedHostId,
            paramsKeys: Object.keys(params),
          })

          const query = `
            ALTER TABLE ${TABLE_SETTINGS}
            UPDATE value = {value:String}, updated_at = NOW()
            WHERE key = {key:String}
          `

          const query_params = {
            key: 'params',
            value: JSON.stringify(params),
          }

          const client = await getClient({ hostId: parsedHostId })
          await client.command({
            query,
            query_params,
          })

          const response: ApiResponse<{ success: boolean }> = {
            success: true,
            data: { success: true },
            metadata: {
              queryId: 'dashboard-settings-update',
              duration: 0,
              rows: 0,
              host: String(parsedHostId),
            },
          }

          return Response.json(response, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : 'Unknown error occurred'

          error('[POST /api/v1/dashboard/settings] Error:', errorMessage)
          return makeErrorResponse(
            ApiErrorType.QueryError,
            errorMessage,
            500,
            ROUTE_CONTEXT_POST
          )
        }
      },
    },
  },
})
