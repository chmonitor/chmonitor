/**
 * POST /api/v1/auth/device/code — rate limit guard (test export).
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  checkRateLimitDurable,
  clientIpKey,
  getDeviceCodeRateLimitPerMin,
  RATE_LIMIT_BINDING_DEVICE_CODE,
  rateLimitResponse,
} from '@/lib/api/rate-limiter'
import { insertDeviceCode } from '@/lib/auth/device-code-store'
import { resolveDeviceLogin } from '@/lib/auth/device-login-config'

const DEFAULT_EXPIRES_IN = 900
const DEFAULT_INTERVAL = 5
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let out = ''
  for (let i = 0; i < 8; i += 1) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length]
    if (i === 3) out += '-'
  }
  return out
}

function randomDeviceCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function disabledResponse(reason: string | null): Response {
  const message =
    reason === 'missing_api_key_secret'
      ? 'Device login requires CHM_API_KEY_SECRET'
      : reason === 'disabled'
        ? 'Device login is disabled (set CHM_DEVICE_LOGIN=true to enable on self-hosted)'
        : 'Device login is unavailable'
  return Response.json(
    { error: message, reason: reason ?? 'unavailable' },
    {
      status: 503,
    }
  )
}

async function checkDeviceCodeRateLimit(
  request: Request
): Promise<Response | null> {
  const rl = await checkRateLimitDurable(
    `device-code:ip:${clientIpKey(request)}`,
    getDeviceCodeRateLimitPerMin(),
    RATE_LIMIT_BINDING_DEVICE_CODE
  )
  if (rl.allowed) return null
  return rateLimitResponse(rl.retryAfterSec)
}

async function handlePost(request: Request): Promise<Response> {
  const status = resolveDeviceLogin()
  if (!status.enabled) {
    return disabledResponse(status.reason)
  }

  const rateLimited = await checkDeviceCodeRateLimit(request)
  if (rateLimited) return rateLimited

  let clientId = 'chm-cli'
  try {
    const raw = await request.text()
    if (raw.trim()) {
      const body = JSON.parse(raw) as Record<string, unknown>
      if (typeof body.client_id === 'string' && body.client_id.trim()) {
        clientId = body.client_id.trim()
      }
    }
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  const now = Date.now()
  const deviceCode = randomDeviceCode()
  const userCode = randomUserCode()
  const expiresIn = DEFAULT_EXPIRES_IN
  const interval = DEFAULT_INTERVAL

  const ok = await insertDeviceCode({
    deviceCode,
    userCode,
    clientId,
    createdAt: now,
    expiresAt: now + expiresIn * 1000,
    intervalSec: interval,
  })
  if (!ok) {
    return Response.json(
      { error: 'Failed to create device code' },
      { status: 503 }
    )
  }

  const origin = new URL(request.url).origin
  const verificationUri = `${origin}/device`
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`

  const payload = {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: verificationUriComplete,
    expires_in: expiresIn,
    interval,
  }

  // `{ data }` is the dashboard envelope; top-level fields keep the CLI
  // (flat OAuth deserialize) working without a second round-trip.
  return Response.json({ data: payload, ...payload })
}

export const Route = createFileRoute('/api/v1/auth/device/code')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

export {
  checkDeviceCodeRateLimit as __checkDeviceCodeRateLimitForTests,
  handlePost as __handlePostForTests,
}
