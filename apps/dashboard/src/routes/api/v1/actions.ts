/**
 * Actions API Endpoint
 * POST /api/v1/actions?hostId=0
 *
 * Executes ClickHouse actions: killQuery, optimizeTable, querySettings.
 * Ported from apps/dashboard/app/api/v1/actions/route.ts.
 */

import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { ErrorLogger, log } from '@chm/logger'
import { sanitizeClickHouseError } from '@/lib/api/error-handler/sanitize-error'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { quoteTableIdentifier } from '@/lib/api/shared/sql-identifier'
import { isDemoHostBlockedForRequest } from '@/lib/cloud/reject-demo-host'
import { ACTIONS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

// --- Inline ActionSchema (not yet ported to TSR lib/api/schemas) ---

const KillQueryActionSchema = z.object({
  action: z.literal('killQuery'),
  params: z.object({
    queryId: z.string().min(1, 'queryId must not be empty'),
  }),
})

const OptimizeTableActionSchema = z.object({
  action: z.literal('optimizeTable'),
  params: z.object({
    table: z.string().min(1, 'table must not be empty'),
  }),
})

const QuerySettingsActionSchema = z.object({
  action: z.literal('querySettings'),
  params: z.object({
    queryId: z.string().min(1, 'queryId must not be empty'),
  }),
})

const ActionSchema = z.discriminatedUnion('action', [
  KillQueryActionSchema,
  OptimizeTableActionSchema,
  QuerySettingsActionSchema,
])

type Action = z.infer<typeof ActionSchema>

// --- Helpers ---

/**
 * Valid SQL identifier pattern for table names.
 * Allows: database.table, table, `quoted.table`
 */
const VALID_TABLE_IDENTIFIER =
  /^(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)(\.[\s]*(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*))?$/

function isValidTableIdentifier(table: string): boolean {
  if (!table || table.length > 256) return false
  return VALID_TABLE_IDENTIFIER.test(table.trim())
}

function generateRequestId(): string {
  return Math.random().toString(36).slice(2, 10)
}

interface ActionResult {
  success: boolean
  message: string
  data?: unknown
}

async function handleKillQuery(
  hostId: number,
  queryId: string
): Promise<ActionResult> {
  const { error } = await fetchData({
    query: `KILL QUERY WHERE query_id = {queryId:String}`,
    query_params: { queryId },
    hostId,
  })

  if (error) {
    ErrorLogger.logError(new Error(error.message), {
      action: 'killQuery',
      queryId,
      errorType: error.type,
    })
    return {
      success: false,
      message: `Failed to kill query ${queryId}: ${sanitizeClickHouseError(error.message)}`,
    }
  }

  return { success: true, message: `Killed query ${queryId}` }
}

async function handleOptimizeTable(
  hostId: number,
  table: string
): Promise<ActionResult> {
  if (!isValidTableIdentifier(table)) {
    ErrorLogger.logError(new Error('Invalid table identifier'), {
      action: 'optimizeTable',
      table,
      reason: 'Failed identifier validation',
    })
    return {
      success: false,
      message: `Invalid table identifier: ${table}. Table names must be alphanumeric with optional database prefix.`,
    }
  }

  const { error } = await fetchData({
    query: `OPTIMIZE TABLE ${quoteTableIdentifier(table)}`,
    hostId,
  })

  if (error) {
    ErrorLogger.logError(new Error(error.message), {
      action: 'optimizeTable',
      table,
      errorType: error.type,
    })
    return {
      success: false,
      message: `Failed to optimize table ${table}: ${sanitizeClickHouseError(error.message)}`,
    }
  }

  return { success: true, message: `Running query optimize table ${table}` }
}

async function handleQuerySettings(
  hostId: number,
  queryId: string
): Promise<ActionResult> {
  const { data, error } = await fetchData<{ Settings: string }[]>({
    query: `SELECT Settings FROM system.processes WHERE query_id = {queryId:String}`,
    query_params: { queryId },
    hostId,
  })

  if (error) {
    ErrorLogger.logError(new Error(error.message), {
      action: 'querySettings',
      queryId,
      errorType: error.type,
    })
    return {
      success: false,
      message: `Failed to get query settings ${queryId}: ${sanitizeClickHouseError(error.message)}`,
    }
  }

  return { success: true, message: JSON.stringify(data), data }
}

// --- Route ---

export const Route = createFileRoute('/api/v1/actions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bindings = env as Record<string, string | undefined>
        bridgeClickHouseEnv(bindings)

        // Feature-permission gate: mutating actions (KILL QUERY / OPTIMIZE
        // TABLE) honor CHM_FEATURE_ACTIONS_ACCESS / disabled-feature config
        // independently of the global API guard. The global guard is a
        // public passthrough under provider='none', so without this an
        // operator who sets actions to `authenticated`/disabled would be
        // silently ignored (anonymous mutating actions). Matches the
        // dashboard route.
        const permissionResponse = await authorizeFeatureRequest(
          ACTIONS_FEATURE_PERMISSION,
          request,
          // Accept a valid `chm_` API key as authentication so programmatic
          // clients keep working now that actions defaults to `authenticated`.
          { allowAgentBearerToken: true }
        )
        if (permissionResponse) return permissionResponse

        const requestId = generateRequestId()

        const url = new URL(request.url)
        const hostIdRaw = url.searchParams.get('hostId')

        if (hostIdRaw === null || hostIdRaw === '') {
          return Response.json(
            { success: false, message: 'Missing required parameter: hostId' },
            { status: 400 }
          )
        }

        const hostId = Number.parseInt(hostIdRaw, 10)
        if (!Number.isInteger(hostId) || hostId < 0) {
          return Response.json(
            {
              success: false,
              message:
                'Invalid parameter: hostId must be a non-negative integer',
            },
            { status: 400 }
          )
        }

        // Cloud demo-hiding invariant (#2172): user connections always use
        // negative hostIds, so a non-negative id from a signed-in cloud
        // principal can only be the hidden env/demo host. querySettings
        // echoes real ClickHouse data back, so the whole endpoint (including
        // the killQuery/optimizeTable mutations) is guarded here rather than
        // per-action. No-op for OSS and anonymous cloud callers (both
        // legitimately use hostId=0).
        if (await isDemoHostBlockedForRequest(hostId, bindings)) {
          return new Response(
            JSON.stringify({
              success: true,
              message: 'The demo host is hidden for signed-in accounts.',
              data: [],
              unavailable: {
                reason: 'demo_hidden',
                message: 'The demo host is hidden for signed-in accounts.',
              },
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Request-ID': requestId,
              },
            }
          )
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(
            { success: false, message: 'Invalid JSON body' },
            { status: 400 }
          )
        }

        const parseResult = ActionSchema.safeParse(body)
        if (!parseResult.success) {
          const errorMessages = parseResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')
          return Response.json(
            {
              success: false,
              message: `Invalid action request: ${errorMessages}`,
            },
            { status: 400 }
          )
        }

        const action: Action = parseResult.data

        log('[AUDIT] Action requested', {
          requestId,
          action: action.action,
          hostId,
          params: action.params,
        })

        let result: ActionResult

        switch (action.action) {
          case 'killQuery':
            result = await handleKillQuery(hostId, action.params.queryId)
            break

          case 'optimizeTable':
            result = await handleOptimizeTable(hostId, action.params.table)
            break

          case 'querySettings':
            result = await handleQuerySettings(hostId, action.params.queryId)
            break
        }

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
          },
        })
      },
    },
  },
})
