/**
 * GET /api/v1/agents/anyrouter/login
 *
 * Starts the "Sign in with AnyRouter" popup flow (see
 * `lib/ai/anyrouter-signin.ts` for the verified upstream OAuth contract).
 * Generates a fresh PKCE pair + CSRF state, lazily registers (or reuses a
 * pinned) OAuth client, stores `{ state, code_verifier }` in a short-lived
 * httpOnly cookie scoped to this route's path — never returned to page JS —
 * and hands the browser only the `authorizeUrl` to redirect the popup to.
 *
 * Gated the same way as GET /api/v1/agents/models: an anonymous visitor in
 * cloud mode cannot spin this flow if the agent feature itself isn't
 * available to them.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import {
  AnyRouterSigninError,
  buildAuthorizeUrl,
  serializeSigninCookie,
} from '@/lib/ai/anyrouter-signin'
import { authorizeAgentApiRequest } from '@/lib/auth/agent-api-auth'

async function handleGet(request: Request): Promise<Response> {
  const authResponse = await authorizeAgentApiRequest(request)
  if (authResponse) return authResponse

  try {
    const clientEnv = env as { ANYROUTER_OAUTH_CLIENT_ID?: string }
    const { authorizeUrl, state, codeVerifier } = await buildAuthorizeUrl(
      request,
      {
        ANYROUTER_OAUTH_CLIENT_ID: clientEnv.ANYROUTER_OAUTH_CLIENT_ID,
      }
    )

    const secure = new URL(request.url).protocol === 'https:'
    const cookie = serializeSigninCookie(
      { v: codeVerifier, s: state },
      { secure }
    )

    return Response.json(
      { authorizeUrl, state },
      { headers: { 'Set-Cookie': cookie } }
    )
  } catch (error) {
    const message =
      error instanceof AnyRouterSigninError
        ? error.message
        : 'Failed to start AnyRouter sign-in'
    console.error('AnyRouter sign-in start failed:', error)
    return Response.json({ error: message }, { status: 502 })
  }
}

export const Route = createFileRoute('/api/v1/agents/anyrouter/login')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

export { handleGet as __handleGetForTests }
