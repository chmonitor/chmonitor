/**
 * POST /api/v1/auth/device/code
 *
 * RFC 8628 device authorization — public. Creates a pending device/user code
 * pair in D1. Returns 503 when CHM_CLOUD_D1 is unavailable.
 */

import { createFileRoute } from '@tanstack/react-router'

import {
  deviceLoginAvailable,
  insertDeviceCode,
} from '@/lib/auth/device-code-store'

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

async function handlePost(request: Request): Promise<Response> {
  if (!deviceLoginAvailable()) {
    return Response.json(
      { error: 'Device login is unavailable (D1 not configured)' },
      { status: 503 }
    )
  }

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
