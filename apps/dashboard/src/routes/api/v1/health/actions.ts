/**
 * Remediation Action Execute Endpoint
 * POST /api/v1/health/actions
 *
 * Executes a labeled remediation action declared on an alert rule's
 * `remediationActions` (plans/33-remediation-action-links.md) — either a
 * `runbook` link (nothing to execute, just returns the URL) or a `diagnostic`
 * READ-ONLY SQL query that returns extra context to cut MTTR.
 *
 * CRITICAL INVARIANT: this endpoint NEVER executes DDL or any mutation. It
 * only ever runs the SQL attached to a rule's declared `diagnostic` action —
 * resolved server-side from `ruleRegistry`, never taken from the request body
 * — and that SQL is re-validated with `assertReadOnlyAction` immediately
 * before execution (defense in depth on top of the declaration-time check
 * covered by rule-registry tests). Remediation stays ACK-gated and manual;
 * this is affordance, not automation.
 *
 * Auth-gated exactly like the other mutating health routes (health/webhook.ts,
 * actions.ts): a read-only query is still a cluster call, so anonymous
 * callers cannot trigger it even under a public-read deployment.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { fetchData } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import {
  assertReadOnlyAction,
  ruleRegistry,
} from '@/lib/alerting/rule-registry'
import { sanitizeClickHouseError } from '@/lib/api/error-handler/sanitize-error'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { HEALTH_ACTIONS_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/actions',
  method: 'POST',
} as const

/** Cap diagnostic result rows so a broad query can't return unbounded output. */
const MAX_ROWS = 50

interface ActionRequestBody {
  hostId?: number
  ruleId?: string
  actionId?: string
}

interface ActionSuccessResult {
  success: true
  kind: 'runbook' | 'diagnostic'
  url?: string
  rows?: unknown[]
  rowCount?: number
  truncated?: boolean
}

async function handlePost(request: Request): Promise<Response> {
  // Write gate: even a read-only diagnostic still issues an on-demand cluster
  // call, so this must self-enforce auth the same way as the other mutating
  // health routes (the global /api/v1 middleware is a public passthrough
  // under provider='none' / CHM_CLERK_PUBLIC_READ).
  const permissionResponse = await authorizeFeatureRequest(
    HEALTH_ACTIONS_FEATURE_PERMISSION,
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  let body: ActionRequestBody
  try {
    body = (await request.json()) as ActionRequestBody
  } catch {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'Request body must be valid JSON',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  const { hostId, ruleId, actionId } = body

  if (
    typeof hostId !== 'number' ||
    !Number.isInteger(hostId) ||
    hostId < 0 ||
    typeof ruleId !== 'string' ||
    ruleId.length === 0 ||
    typeof actionId !== 'string' ||
    actionId.length === 0
  ) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'Missing or invalid fields: expected { hostId: number, ruleId: string, actionId: string }',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  const rule = ruleRegistry.get(ruleId)
  if (!rule) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: `Unknown rule: ${ruleId}`,
      },
      400,
      ROUTE_CONTEXT
    )
  }

  // The action + its SQL are resolved server-side from the rule definition —
  // never from the request body — so a client cannot smuggle arbitrary SQL
  // through `actionId`.
  const action = rule.remediationActions?.find((a) => a.id === actionId)
  if (!action) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: `Unknown action "${actionId}" for rule "${ruleId}"`,
      },
      400,
      ROUTE_CONTEXT
    )
  }

  if (action.kind === 'runbook') {
    debug('[POST /api/v1/health/actions] Resolved runbook action', {
      ruleId,
      actionId,
      hostId,
    })
    const result: ActionSuccessResult = {
      success: true,
      kind: 'runbook',
      url: action.url,
    }
    return Response.json(result, { status: 200 })
  }

  // action.kind === 'diagnostic' — defense in depth: re-validate read-only
  // even though declaration-time tests should have already caught a bad rule.
  try {
    assertReadOnlyAction(action)
  } catch (err) {
    error(
      '[POST /api/v1/health/actions] Rejected non-read-only diagnostic action',
      err,
      { ruleId, actionId }
    )
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          err instanceof Error ? err.message : 'Action failed validation',
      },
      422,
      ROUTE_CONTEXT
    )
  }

  // TODO(27): record a structured action-invocation history entry once
  // alert_events (plans/27-alert-history-audit-log.md) gains actionId/actor/
  // result columns — its current schema is shaped for threshold-breach
  // dispatch (severity is NOT NULL with no honest value for "action
  // invoked"), so forcing a row in today's shape would be misleading audit
  // data. `debug()` below is the interim record, per this plan's own
  // "(Optional) intent log" section.
  debug('[POST /api/v1/health/actions] Executing diagnostic action', {
    ruleId,
    actionId,
    hostId,
  })

  const { data, error: fetchError } = await fetchData<
    Array<Record<string, unknown>>
  >({
    query: action.sql as string,
    hostId,
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: '1' },
  })

  if (fetchError) {
    error(
      '[POST /api/v1/health/actions] Diagnostic query failed',
      new Error(fetchError.message),
      { ruleId, actionId, hostId }
    )
    return createErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: sanitizeClickHouseError(fetchError.message),
      },
      500,
      ROUTE_CONTEXT
    )
  }

  const rows = Array.isArray(data) ? data : []
  const truncated = rows.length > MAX_ROWS

  const result: ActionSuccessResult = {
    success: true,
    kind: 'diagnostic',
    rows: rows.slice(0, MAX_ROWS),
    rowCount: rows.length,
    truncated,
  }
  return Response.json(result, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/actions')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
