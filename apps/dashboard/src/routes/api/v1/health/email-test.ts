/**
 * Health Email Test-Send Endpoint
 * POST /api/v1/health/email-test
 *
 * Sends a test alert email using the server-configured email settings
 * (`HEALTH_ALERT_EMAIL_*`, read via `getServerEmailConfig`). Unlike
 * `/api/v1/health/webhook`, this route has NO SSRF surface: it never fetches a
 * caller-supplied URL — the request body carries no destination at all, only
 * the operator's already-configured provider/recipients are used. This mirrors
 * the "send test webhook" affordance in the health settings dialog.
 *
 * Auth: same write-gate as the webhook proxy — the global /api/v1 middleware
 * is a public passthrough under provider='none' / CHM_CLERK_PUBLIC_READ, so
 * this route self-enforces that anonymous callers cannot trigger the outbound
 * send. A valid `chm_` API key still authenticates programmatic clients.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { buildEmailBody } from '@/lib/health/adapters'
import { sendAlertEmail } from '@/lib/health/email-transport'
import { getServerEmailConfig } from '@/lib/health/server-alert-config'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/email-test',
  method: 'POST',
} as const

async function handlePost(request: Request): Promise<Response> {
  // Write gate: this POST triggers a real outbound send. Mirrors the webhook
  // proxy's guard (see webhook.ts) — anonymous callers cannot trigger it, a
  // valid `chm_` API key can.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const emailConfig = getServerEmailConfig()
  if (!emailConfig) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'Email alerts are not configured. Set HEALTH_ALERT_EMAIL_ENABLED, HEALTH_ALERT_EMAIL_TO, HEALTH_ALERT_EMAIL_FROM, and HEALTH_ALERT_EMAIL_PROVIDER_URL.',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  const body = buildEmailBody({
    severity: 'warning',
    hostLabel: 'Test host',
    hostId: 0,
    metric: 'test-alert',
    value: 0,
    title: 'Test Alert',
    label: 'This is a test alert from chmonitor',
    timestamp: new Date().toISOString(),
  })

  try {
    const ok = await sendAlertEmail(emailConfig, body)
    if (!ok) {
      return createErrorResponse(
        {
          type: ApiErrorType.NetworkError,
          message:
            'Failed to send test email. Check server logs and HEALTH_ALERT_EMAIL_PROVIDER_URL.',
        },
        502,
        ROUTE_CONTEXT
      )
    }
    return Response.json({ success: true }, { status: 200 })
  } catch (err) {
    error('[POST /api/v1/health/email-test] Unexpected failure', err)
    return createErrorResponse(
      {
        type: ApiErrorType.NetworkError,
        message: 'Failed to send test email due to an unexpected error.',
      },
      502,
      ROUTE_CONTEXT
    )
  }
}

export const Route = createFileRoute('/api/v1/health/email-test')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
