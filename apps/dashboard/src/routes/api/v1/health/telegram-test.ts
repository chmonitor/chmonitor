/**
 * Telegram Test-Message Endpoint
 * GET  /api/v1/health/telegram-test  — is Telegram configured server-side?
 * POST /api/v1/health/telegram-test  — send a synthetic test message
 *
 * The Telegram bot token (`HEALTH_ALERT_TELEGRAM_BOT_TOKEN`) is a server-only
 * secret (see `server-alert-config.ts`) that must never round-trip to the
 * browser — like the Opsgenie API key, there is no client-supplied credential
 * for the env-configured global chat. This endpoint lets the settings UI (a)
 * show whether Telegram is configured and (b) fire a real test dispatch through
 * the server's own config, without ever exposing the token (#2655).
 */

import { createFileRoute } from '@tanstack/react-router'

import type { TelegramDispatchDeps } from '@/lib/health/telegram-dispatch'

import { debug } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { getServerTelegramConfig } from '@/lib/health/server-alert-config'
import { dispatchTelegram } from '@/lib/health/telegram-dispatch'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/telegram-test',
  method: 'POST',
} as const

async function handleGet(): Promise<Response> {
  const config = getServerTelegramConfig()
  return Response.json({ configured: config !== null })
}

async function handlePost(
  request: Request,
  deps: TelegramDispatchDeps = {}
): Promise<Response> {
  // Write gate, same posture as /api/v1/health/webhook — this triggers a
  // real outbound Telegram dispatch, so anonymous callers must not reach it.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const config = getServerTelegramConfig()
  if (!config) {
    return createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message:
          'Telegram is not configured. Set HEALTH_ALERT_TELEGRAM_BOT_TOKEN and HEALTH_ALERT_TELEGRAM_CHAT_ID on the server.',
      },
      400,
      ROUTE_CONTEXT
    )
  }

  debug('[POST /api/v1/health/telegram-test] Sending test message')

  const ok = await dispatchTelegram(
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
        message: 'Telegram test message failed. Check the server logs.',
      },
      502,
      ROUTE_CONTEXT
    )
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/telegram-test')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePost as __handlePostForTests }
