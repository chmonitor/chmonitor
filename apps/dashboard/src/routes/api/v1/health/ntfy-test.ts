/**
 * ntfy Test-Message Endpoint
 * GET  /api/v1/health/ntfy-test  — is ntfy configured server-side (env global)?
 * POST /api/v1/health/ntfy-test  — send a synthetic test notification
 *
 * Two POST modes:
 *   - No body (or `{}`)         → test the env-configured global topic
 *     (`HEALTH_ALERT_NTFY_URL` / `_TOKEN`). Used by the Health Settings button.
 *   - `{ url, token? }`         → test an ad-hoc topic the operator just typed
 *     into the routing dialog. Because that URL is caller-supplied, it goes
 *     through the same SSRF guard (`validateHostUrl`, HTTPS-only) as the generic
 *     webhook proxy before any egress — unlike Telegram, whose fixed Bot API
 *     host lets the routing dialog reuse the generic webhook proxy. ntfy needs
 *     Title/Priority/Tags HTTP headers the generic proxy can't emit, so its
 *     per-route test rides this route instead (#2657).
 *
 * The ntfy token is a server-side secret (never round-tripped to the browser
 * after storage); in the ad-hoc mode the operator just typed it, same posture
 * as the Telegram/PagerDuty routing-key tests.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { NtfyDispatchDeps } from '@/lib/health/ntfy-dispatch'
import type { ServerNtfyConfig } from '@/lib/health/server-alert-config'

import { debug } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  type ResolveHostAddresses,
  validateHostUrl,
} from '@/lib/browser-connections/host-url'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { dispatchNtfy } from '@/lib/health/ntfy-dispatch'
import { getServerNtfyConfig } from '@/lib/health/server-alert-config'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/ntfy-test',
  method: 'POST',
} as const

/** Injectable deps for tests (fetch + DNS resolver for the SSRF guard). */
interface NtfyTestDeps extends NtfyDispatchDeps {
  resolveHostAddresses?: ResolveHostAddresses
}

interface NtfyTestBody {
  url?: unknown
  token?: unknown
}

async function handleGet(): Promise<Response> {
  const config = getServerNtfyConfig()
  return Response.json({ configured: config !== null })
}

async function handlePost(
  request: Request,
  deps: NtfyTestDeps = {}
): Promise<Response> {
  // Write gate, same posture as /api/v1/health/webhook — this triggers a real
  // outbound ntfy dispatch, so anonymous callers must not reach it.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  // Body is optional: absent → env-global test. A supplied `url` switches to
  // the ad-hoc mode (SSRF-validated below).
  let body: NtfyTestBody = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text) as NtfyTestBody
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

  const adHocUrl = typeof body.url === 'string' ? body.url.trim() : ''
  const adHocToken = typeof body.token === 'string' ? body.token.trim() : ''

  let config: ServerNtfyConfig | null
  if (adHocUrl) {
    if (!adHocUrl.startsWith('https://')) {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'Invalid "url": expected an HTTPS ntfy topic URL',
        },
        400,
        ROUTE_CONTEXT
      )
    }
    const ssrfError = await validateHostUrl(adHocUrl, deps.resolveHostAddresses)
    if (ssrfError) {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message: 'The ntfy URL is not allowed. Use a public HTTPS endpoint.',
        },
        400,
        ROUTE_CONTEXT
      )
    }
    config = adHocToken
      ? { url: adHocUrl, token: adHocToken }
      : { url: adHocUrl }
  } else {
    config = getServerNtfyConfig()
    if (!config) {
      return createErrorResponse(
        {
          type: ApiErrorType.ValidationError,
          message:
            'ntfy is not configured. Set HEALTH_ALERT_NTFY_URL on the server, or pass a topic URL.',
        },
        400,
        ROUTE_CONTEXT
      )
    }
  }

  debug('[POST /api/v1/health/ntfy-test] Sending test notification')

  const ok = await dispatchNtfy(
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
        message: 'ntfy test notification failed. Check the server logs.',
      },
      502,
      ROUTE_CONTEXT
    )
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/ntfy-test')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePost as __handlePostForTests }
