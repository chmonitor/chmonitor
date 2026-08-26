/**
 * POST /api/v1/auth/token
 *
 * OAuth device_code grant. Polls until the user approves at `/device`, then
 * mints a `chm_` API key for the approving user (30 days, all scopes).
 *
 * Pending → `{ error: 'authorization_pending' }` with status 400.
 */

import { createFileRoute } from '@tanstack/react-router'

import { ALL_API_KEY_SCOPES, issueApiKey } from '@chm/mcp-server/auth'
import {
  checkRateLimitDurable,
  clientIpKey,
  getDeviceCodeRateLimitPerMin,
  RATE_LIMIT_BINDING_DEVICE_CODE,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import {
  enforceDeviceCodePollInterval,
  getByDeviceCode,
  markConsumed,
} from '@/lib/auth/device-code-store'
import { resolveDeviceLogin } from '@/lib/auth/device-login-config'

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const DEVICE_GRANT_SHORT = 'device_code'
const TOKEN_DAYS = 30

function oauthError(
  error: string,
  description: string,
  status = 400
): Response {
  return Response.json({ error, error_description: description }, { status })
}

async function handlePost(request: Request): Promise<Response> {
  const deviceStatus = resolveDeviceLogin()
  if (!deviceStatus.enabled) {
    const message =
      deviceStatus.reason === 'missing_api_key_secret'
        ? 'CHM_API_KEY_SECRET is not configured'
        : 'Device login is disabled'
    return Response.json(
      { error: message, reason: deviceStatus.reason ?? 'disabled' },
      { status: 503 }
    )
  }

  const rl = await checkRateLimitDurable(
    `device-token:ip:${clientIpKey(request)}`,
    getDeviceCodeRateLimitPerMin(),
    RATE_LIMIT_BINDING_DEVICE_CODE
  )
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSec)

  let grantType: string | undefined
  let deviceCode: string | undefined
  try {
    const body = (await request.json()) as Record<string, unknown>
    grantType =
      typeof body.grant_type === 'string' ? body.grant_type : undefined
    deviceCode =
      typeof body.device_code === 'string' ? body.device_code : undefined
  } catch {
    return oauthError('invalid_request', 'Request body must be valid JSON')
  }

  if (grantType !== DEVICE_GRANT && grantType !== DEVICE_GRANT_SHORT) {
    return oauthError(
      'unsupported_grant_type',
      'Only device_code grant is supported'
    )
  }

  if (!deviceCode) {
    return oauthError('invalid_request', 'device_code is required')
  }

  const record = await getByDeviceCode(deviceCode)
  if (!record) {
    return oauthError('invalid_grant', 'Unknown device_code')
  }

  if (record.consumedAt != null) {
    return oauthError('invalid_grant', 'device_code already used')
  }

  if (record.expiresAt <= Date.now()) {
    return oauthError('expired_token', 'device_code has expired')
  }

  if (record.approvedAt == null || !record.userId) {
    const poll = await enforceDeviceCodePollInterval(record)
    if (poll === 'slow_down') {
      return Response.json(
        { error: 'slow_down', interval: record.intervalSec },
        { status: 429 }
      )
    }
    return oauthError('authorization_pending', 'Waiting for user authorization')
  }

  try {
    const accessToken = await issueApiKey(record.userId, TOKEN_DAYS, [
      ...ALL_API_KEY_SCOPES,
    ])
    await markConsumed(deviceCode)
    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_DAYS * 86400,
    })
  } catch (err) {
    return Response.json(
      {
        error: 'server_error',
        error_description:
          err instanceof Error ? err.message : 'Failed to issue token',
      },
      { status: 500 }
    )
  }
}

export const Route = createFileRoute('/api/v1/auth/token')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

export { handlePost as __handlePostForTests }
