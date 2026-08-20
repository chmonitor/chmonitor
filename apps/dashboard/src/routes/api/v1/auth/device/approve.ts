/**
 * POST /api/v1/auth/device/approve
 *
 * Approves a pending device user_code for the signed-in Clerk/proxy principal.
 * Body: `{ user_code: string }`.
 */

import { createFileRoute } from '@tanstack/react-router'

import { approveUserCode } from '@/lib/auth/device-code-store'
import { getAuthProvider } from '@/lib/auth/provider'
import { resolveServerAuthProvider } from '@/lib/auth/providers'

async function handlePost(request: Request): Promise<Response> {
  let provider: ReturnType<typeof getAuthProvider>
  try {
    provider = getAuthProvider()
  } catch {
    return Response.json(
      { error: 'Invalid auth provider configuration' },
      { status: 500 }
    )
  }

  if (provider === 'none') {
    return Response.json(
      { error: 'Device approval requires an authenticated session' },
      { status: 401 }
    )
  }

  const auth =
    await resolveServerAuthProvider(provider).authenticateRequest(request)
  const userId = auth.subject ?? auth.principal?.subject
  if (!auth.authenticated || !userId) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
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

  return Response.json({ data: { approved: true } })
}

export const Route = createFileRoute('/api/v1/auth/device/approve')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})
