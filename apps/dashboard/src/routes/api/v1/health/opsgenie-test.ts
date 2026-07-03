/**
 * Opsgenie Test-Alert Endpoint
 * GET  /api/v1/health/opsgenie-test  — is Opsgenie configured server-side?
 * POST /api/v1/health/opsgenie-test  — send a synthetic test alert
 *
 * The Opsgenie API key (`HEALTH_ALERT_OPSGENIE_API_KEY`) is a server-only
 * secret (see `server-alert-config.ts`) that must never round-trip to the
 * browser — unlike the webhook URL (which the user types in and is proxied
 * per-request via `/api/v1/health/webhook`), Opsgenie has no client-supplied
 * credential. This endpoint lets the settings UI (a) show whether Opsgenie is
 * configured and (b) fire a real test dispatch through the server's own
 * config, without ever exposing the key.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { OpsgenieDispatchDeps } from '@/lib/health/opsgenie-dispatch'

import { debug } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { dispatchOpsgenie } from '@/lib/health/opsgenie-dispatch'
import { getServerOpsgenieConfig } from '@/lib/health/server-alert-config'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/opsgenie-test',
  method: 'POST',
} as const

async function handleGet(): Promise<Response> {
  const config = getServerOpsgenieConfig()
  return Response.json({
    configured: config !== null,
    region: config?.region ?? null,
  })
}

async function handlePost(
  request: Request,
  deps: OpsgenieDispatchDeps = {}
): Promise<Response> {
  // Write gate, same posture as /api/v1/health/webhook — this triggers a
  // real outbound Opsgenie dispatch, so anonymous callers must not reach it.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const config = getServerOpsgenieConfig()
  if (!config) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'Opsgenie is not configured. Set HEALTH_ALERT_OPSGENIE_API_KEY on the server.',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  debug('[POST /api/v1/health/opsgenie-test] Sending test alert')

  const ok = await dispatchOpsgenie(
    {
      severity: 'warning',
      hostLabel: 'test-host',
      hostId: 0,
      metric: 'test',
      value: 0,
      warnThreshold: null,
      critThreshold: null,
      title: 'Test Alert',
      label: 'This is a test alert from chmonitor',
      timestamp: new Date().toISOString(),
    },
    config,
    deps
  )

  if (!ok) {
    return createErrorResponse(
      {
        type: ApiErrorType.NetworkError,
        message: 'Opsgenie test alert failed. Check the server logs.',
      },
      502,
      ROUTE_CONTEXT
    )
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/opsgenie-test')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePost as __handlePostForTests }
