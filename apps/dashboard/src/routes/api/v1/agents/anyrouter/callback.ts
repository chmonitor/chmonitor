/**
 * GET /api/v1/agents/anyrouter/callback
 *
 * Finishes the "Sign in with AnyRouter" popup flow started by
 * `GET /api/v1/agents/anyrouter/login` (see `lib/ai/anyrouter-signin.ts` for
 * the verified upstream OAuth contract). Validates `state` against the
 * httpOnly cookie set at login (constant-time compare), exchanges the
 * authorization `code` + PKCE verifier for an AnyRouter access token, clears
 * the cookie, and returns a tiny self-contained HTML page that `postMessage`s
 * the result to `window.opener` and closes the popup.
 *
 * This route is intentionally NOT gated by `authorizeAgentApiRequest` — it is
 * the redirect target AnyRouter itself navigates the popup to, with no
 * chmonitor session/auth headers attached. Its only trust anchor is the
 * signin cookie minted by the (gated) login route, which the state check
 * enforces.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import {
  AnyRouterSigninError,
  buildSigninResultHtml,
  clearSigninCookieHeader,
  deriveOriginUrl,
  deriveRedirectUri,
  exchangeCodeForToken,
  getOrRegisterClientId,
  parseSigninCookie,
} from '@/lib/ai/anyrouter-signin'
import { secretsMatch } from '@/lib/auth/providers/constant-time'

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' }

function errorResponse(
  message: string,
  originUrl: string,
  secure: boolean
): Response {
  const html = buildSigninResultHtml({ ok: false, error: message }, originUrl)
  return new Response(html, {
    status: 200,
    headers: {
      ...HTML_HEADERS,
      'Set-Cookie': clearSigninCookieHeader({ secure }),
    },
  })
}

async function handleGet(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const originUrl = deriveOriginUrl(request)
  const secure = url.protocol === 'https:'

  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    return errorResponse(
      `AnyRouter sign-in was not completed (${oauthError})`,
      originUrl,
      secure
    )
  }

  const code = url.searchParams.get('code')
  const queryState = url.searchParams.get('state')
  if (!code || !queryState) {
    return errorResponse(
      'AnyRouter sign-in callback is missing code or state',
      originUrl,
      secure
    )
  }

  const cookiePayload = parseSigninCookie(request.headers.get('Cookie'))
  if (!cookiePayload) {
    return errorResponse(
      'AnyRouter sign-in session expired — please try again',
      originUrl,
      secure
    )
  }

  if (!secretsMatch(cookiePayload.s, queryState)) {
    return errorResponse(
      'AnyRouter sign-in state mismatch — please try again',
      originUrl,
      secure
    )
  }

  try {
    const redirectUri = deriveRedirectUri(request)
    const clientEnv = env as { ANYROUTER_OAUTH_CLIENT_ID?: string }
    const clientId = await getOrRegisterClientId(redirectUri, originUrl, {
      ANYROUTER_OAUTH_CLIENT_ID: clientEnv.ANYROUTER_OAUTH_CLIENT_ID,
    })

    const token = await exchangeCodeForToken(
      code,
      cookiePayload.v,
      redirectUri,
      clientId
    )

    const html = buildSigninResultHtml(
      { ok: true, token: token.accessToken, expiresAt: token.expiresAt },
      originUrl
    )
    return new Response(html, {
      status: 200,
      headers: {
        ...HTML_HEADERS,
        'Set-Cookie': clearSigninCookieHeader({ secure }),
      },
    })
  } catch (error) {
    const message =
      error instanceof AnyRouterSigninError
        ? error.message
        : 'AnyRouter sign-in failed'
    console.error('AnyRouter sign-in callback failed:', error)
    return errorResponse(message, originUrl, secure)
  }
}

export const Route = createFileRoute('/api/v1/agents/anyrouter/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

export { handleGet as __handleGetForTests }
