/**
 * Matrix Test-Message Endpoint (native Client-Server API delivery)
 * GET  /api/v1/health/matrix-test  — is Matrix configured server-side (env)?
 * POST /api/v1/health/matrix-test  — send a synthetic test notice
 *
 * Two POST modes:
 *   - No body (or `{}`) → test the env-configured room
 *     (`HEALTH_ALERT_MATRIX_HOMESERVER_URL` / `_ACCESS_TOKEN` / `_ROOM_ID`).
 *   - `{ homeserverUrl, accessToken, roomId }` → test a room the operator just
 *     typed into the routing dialog. The homeserver URL is caller-supplied, so
 *     it goes through the SSRF guard (`validateHostUrl`, HTTPS-only) first.
 *
 * Every test click gets a fresh random txn id: a deterministic one would let
 * the homeserver drop a second test as a retransmission.
 */

import { createFileRoute } from '@tanstack/react-router'

import type {
  MatrixConfig,
  MatrixDispatchDeps,
} from '@/lib/health/matrix-dispatch'

import { debug } from '@chm/logger'
import { createErrorResponse } from '@/lib/api/shared/response-builder'
import { ApiErrorType } from '@/lib/api/types'
import {
  type ResolveHostAddresses,
  validateHostUrl,
} from '@/lib/browser-connections/host-url'
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import {
  dispatchMatrix,
  isValidMatrixRoomId,
  parseMatrixHomeserverUrl,
} from '@/lib/health/matrix-dispatch'
import { getServerMatrixConfig } from '@/lib/health/server-alert-config'
import { buildTestAlertPayload } from '@/lib/health/test-alert-payload'

const ROUTE_CONTEXT = {
  route: '/api/v1/health/matrix-test',
  method: 'POST',
} as const

interface MatrixTestDeps extends MatrixDispatchDeps {
  resolveHostAddresses?: ResolveHostAddresses
}

interface MatrixTestBody {
  homeserverUrl?: unknown
  accessToken?: unknown
  roomId?: unknown
}

function validationError(message: string): Response {
  return createErrorResponse(
    { type: ApiErrorType.ValidationError, message },
    400,
    ROUTE_CONTEXT
  )
}

async function handleGet(): Promise<Response> {
  return Response.json({ configured: getServerMatrixConfig() !== null })
}

async function handlePost(
  request: Request,
  deps: MatrixTestDeps = {}
): Promise<Response> {
  // Write gate, same posture as the ntfy/Pushover tests: this triggers a real
  // outbound send, so anonymous callers must not reach it.
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  let body: MatrixTestBody = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text) as MatrixTestBody
  } catch {
    return validationError('Request body must be valid JSON')
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const rawHomeserverUrl = str(body.homeserverUrl)
  const homeserverUrl = parseMatrixHomeserverUrl(rawHomeserverUrl)
  const accessToken = str(body.accessToken)
  const roomId = str(body.roomId)

  let config: MatrixConfig | null
  if (rawHomeserverUrl || accessToken || roomId) {
    if (!homeserverUrl) {
      return validationError(
        'Invalid "homeserverUrl": expected an HTTPS homeserver URL without credentials, query or fragment'
      )
    }
    if (!accessToken) return validationError('Missing "accessToken"')
    if (!isValidMatrixRoomId(roomId)) {
      return validationError(
        'Invalid "roomId": expected a room id like !abc:example.org, not an alias'
      )
    }
    const ssrfError = await validateHostUrl(
      homeserverUrl,
      deps.resolveHostAddresses
    )
    if (ssrfError) {
      return validationError(
        'The homeserver URL is not allowed. Use a public HTTPS endpoint.'
      )
    }
    config = { homeserverUrl, accessToken, roomId }
  } else {
    config = getServerMatrixConfig()
    if (!config) {
      return validationError(
        'Matrix is not configured. Set HEALTH_ALERT_MATRIX_HOMESERVER_URL, HEALTH_ALERT_MATRIX_ACCESS_TOKEN and HEALTH_ALERT_MATRIX_ROOM_ID on the server, or pass them in the body.'
      )
    }
  }

  debug('[POST /api/v1/health/matrix-test] Sending test notice')

  const result = await dispatchMatrix(buildTestAlertPayload(), config, {
    ...deps,
    txnId: `chm-test-${crypto.randomUUID()}`,
  })

  if (!result.ok) {
    const hint =
      result.errcode === 'M_FORBIDDEN'
        ? ' The bot user must be invited to and joined in the room.'
        : result.errcode === 'M_UNKNOWN_TOKEN'
          ? ' The access token is invalid or expired.'
          : ''
    return createErrorResponse(
      {
        type: ApiErrorType.NetworkError,
        message: `Matrix test notice failed${result.errcode ? ` (${result.errcode})` : result.status ? ` (HTTP ${result.status})` : ''}.${hint}`,
      },
      502,
      ROUTE_CONTEXT
    )
  }

  return Response.json({ success: true }, { status: 200 })
}

export const Route = createFileRoute('/api/v1/health/matrix-test')({
  server: {
    handlers: {
      GET: async () => handleGet(),
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests, handlePost as __handlePostForTests }
