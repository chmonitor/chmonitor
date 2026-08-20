/**
 * POST /api/v1/auth/device/approve
 *
 * Approves a pending device user_code.
 *
 *  - Clerk / proxy / trusted: requires an authenticated session; subject comes
 *    from the identity provider.
 *  - `CHM_AUTH_PROVIDER=none` + device login enabled: **device-only** approve
 *    (no sign-in). Subject is `CHM_DEVICE_LOGIN_SUBJECT` (default `self-hosted`).
 *    Trust model: reachability of `/device` on the operator's network.
 *
 * Body: `{ user_code: string }`.
 */

import { createFileRoute } from '@tanstack/react-router'

import { approveUserCode } from '@/lib/auth/device-code-store'
import { resolveDeviceLogin } from '@/lib/auth/device-login-config'
import { getAuthProvider } from '@/lib/auth/provider'
import { resolveServerAuthProvider } from '@/lib/auth/providers'

async function handlePost(request: Request): Promise<Response> {
  const deviceStatus = resolveDeviceLogin()
  if (!deviceStatus.enabled) {
    const message =
      deviceStatus.reason === 'missing_api_key_secret'
        ? 'Device login requires CHM_API_KEY_SECRET'
        : 'Device login is disabled'
    return Response.json(
      { error: message, reason: deviceStatus.reason ?? 'disabled' },
      { status: 503 }
    )
  }

  let provider: ReturnType<typeof getAuthProvider>
  try {
    provider = getAuthProvider()
  } catch {
    return Response.json(
      { error: 'Invalid auth provider configuration' },
      { status: 500 }
    )
  }

  let userId: string
  if (provider === 'none') {
    // Device-only: anyone who can hit this endpoint (and /device) can mint a
    // token bound to the configured subject. Intended for trusted LAN / VPN.
    userId = deviceStatus.subject
  } else {
    const auth =
      await resolveServerAuthProvider(provider).authenticateRequest(request)
    const subject = auth.subject ?? auth.principal?.subject
    if (!auth.authenticated || !subject) {
      return Response.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }
    userId = subject
  }

  let userCode: string
  try {
    const body = (await request.json()) as Record<string, unknown>
    if (typeof body.user_code !== 'string' || !body.user_code.trim()) {
      return Response.json({ error: 'user_code is required' }, { status: 400 })
    }
    userCode = body.user_code.trim()
  } catch {
    return Response.json(
      { error: 'Request body must be valid JSON' },
      { status: 400 }
    )
  }

  const result = await approveUserCode(userCode, userId)
  if (!result.ok) {
    const status =
      result.error === 'not_found'
        ? 404
        : result.error === 'unavailable'
          ? 503
          : 400
    return Response.json(
      { error: result.error, message: `Cannot approve: ${result.error}` },
      { status }
    )
  }

  return Response.json({
    data: { approved: true, deviceOnly: provider === 'none', subject: userId },
  })
}

export const Route = createFileRoute('/api/v1/auth/device/approve')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
