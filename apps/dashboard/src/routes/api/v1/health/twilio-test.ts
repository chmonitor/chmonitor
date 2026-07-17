/**
 * Twilio Test-SMS Endpoint
 * GET  /api/v1/health/twilio-test  — is Twilio configured server-side?
 * POST /api/v1/health/twilio-test  — send a synthetic test SMS
 *
 * The Twilio auth token (`HEALTH_ALERT_TWILIO_AUTH_TOKEN`) is a server-only
 * secret (see `server-alert-config.ts`) that must never round-trip to the
 * browser — like the Opsgenie API key / Telegram bot token, there is no
 * client-supplied credential for the env-configured global channel. This
 * endpoint lets the settings UI (a) show whether Twilio is configured and
 * (b) fire a real test SMS through the server's own config, without ever
 * exposing the auth token (#2668).
 *
 * A test dispatch sends a real SMS and costs real money — same posture as
 * every other "Send test" button in the settings dialog, just billed.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { TwilioDispatchDeps } from '@/lib/health/twilio-dispatch'

import { debug } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { getServerTwilioConfig } from '@/lib/health/server-alert-config'
import { dispatchTwilio } from '@/lib/health/twilio-dispatch'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/twilio-test',
  method: 'POST',
} as const

async function handleGet(): Promise<Response> {
  const config = getServerTwilioConfig()
  return Response.json({
    configured: config !== null,
    recipients: config?.to.length ?? 0,
  })
}

async function handlePost(
  request: Request,
  deps: TwilioDispatchDeps = {}
): Promise<Response> {
  // Write gate, same posture as /api/v1/health/webhook — this triggers a
  // real outbound (billed) SMS, so anonymous callers must not reach it.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const config = getServerTwilioConfig()
  if (!config) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'Twilio is not configured. Set HEALTH_ALERT_TWILIO_ACCOUNT_SID, HEALTH_ALERT_TWILIO_AUTH_TOKEN, HEALTH_ALERT_TWILIO_FROM, and HEALTH_ALERT_TWILIO_TO on the server.',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  debug('[POST /api/v1/health/twilio-test] Sending test SMS')

  const ok = await dispatchTwilio(
    {
      severity: 'critical',
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
        message: 'Twilio test SMS failed. Check the server logs.',
      },
      502,
      ROUTE_CONTEXT
    )
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/twilio-test')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePost as __handlePostForTests }
