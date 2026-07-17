/**
 * Pushover Test-Message Endpoint
 * GET  /api/v1/health/pushover-test  — is Pushover configured server-side (env global)?
 * POST /api/v1/health/pushover-test  — send a synthetic test notification
 *
 * Two POST modes:
 *   - No body (or `{}`)          → test the env-configured global recipient
 *     (`HEALTH_ALERT_PUSHOVER_TOKEN` / `_USER`). Used by the Health Settings
 *     button.
 *   - `{ token, user }`          → test an ad-hoc recipient the operator just
 *     typed into the routing dialog, before saving it as a route.
 *
 * The Pushover Messages API host is fixed (`api.pushover.net`) — unlike
 * ntfy's operator-supplied topic URL, there is no caller-controlled SSRF sink
 * here, so (unlike `ntfy-test.ts`) no `validateHostUrl` guard is needed.
 *
 * The Pushover application token is a server-side secret (never
 * round-tripped to the browser after storage); in the ad-hoc mode the
 * operator just typed it, same posture as the Telegram/ntfy routing-key
 * tests (#2659).
 */

import { createFileRoute } from '@tanstack/react-router'

import type { PushoverDispatchDeps } from '@/lib/health/pushover-dispatch'
import type { ServerPushoverConfig } from '@/lib/health/server-alert-config'

import { debug } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { dispatchPushover } from '@/lib/health/pushover-dispatch'
import { getServerPushoverConfig } from '@/lib/health/server-alert-config'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/pushover-test',
  method: 'POST',
} as const

interface PushoverTestBody {
  token?: unknown
  user?: unknown
}

async function handleGet(): Promise<Response> {
  const config = getServerPushoverConfig()
  return Response.json({ configured: config !== null })
}

async function handlePost(
  request: Request,
  deps: PushoverDispatchDeps = {}
): Promise<Response> {
  // Write gate, same posture as /api/v1/health/webhook — this triggers a real
  // outbound Pushover dispatch, so anonymous callers must not reach it.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  // Body is optional: absent → env-global test. A supplied `token`/`user`
  // switches to the ad-hoc mode.
  let body: PushoverTestBody = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text) as PushoverTestBody
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

  const adHocToken = typeof body.token === 'string' ? body.token.trim() : ''
  const adHocUser = typeof body.user === 'string' ? body.user.trim() : ''

  let config: ServerPushoverConfig | null
  if (adHocToken || adHocUser) {
    if (!adHocToken || !adHocUser) {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Both "token" and "user" are required for an ad-hoc test',
        },
        400,
        ROUTE_CONTEXT
      )
    }
    config = { token: adHocToken, user: adHocUser }
  } else {
    config = getServerPushoverConfig()
    if (!config) {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message:
            'Pushover is not configured. Set HEALTH_ALERT_PUSHOVER_TOKEN and HEALTH_ALERT_PUSHOVER_USER on the server, or pass a token + user.',
        },
        400,
        ROUTE_CONTEXT
      )
    }
  }

  debug('[POST /api/v1/health/pushover-test] Sending test notification')

  const ok = await dispatchPushover(
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
        message: 'Pushover test notification failed. Check the server logs.',
      },
      502,
      ROUTE_CONTEXT
    )
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/pushover-test')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePost as __handlePostForTests }
