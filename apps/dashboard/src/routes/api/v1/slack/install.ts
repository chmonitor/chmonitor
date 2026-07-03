/**
 * GET /api/v1/slack/install — begin the Slack app OAuth install.
 *
 * The "Add to chmonitor to Slack" entry point. Builds the Slack authorize URL
 * with the configured scopes, this app's redirect URI, and a signed `state`
 * (CSRF) that binds the install to the current chmonitor owner, then 302s the
 * browser to Slack.
 *
 * Fails closed: with the Slack app unconfigured (OSS default) this returns 501
 * and nothing happens. Does NOT require sign-in — owner binding is best-effort
 * (a signed-in Clerk/proxy user is bound by subject; otherwise the install is
 * single-tenant `default`), so the app works for self-hosted OSS with no auth.
 */

import { createFileRoute } from '@tanstack/react-router'

import { getAuthProvider } from '@/lib/auth/provider'
import { resolveServerAuthProvider } from '@/lib/auth/providers'
import {
  getSlackClientId,
  getSlackOAuthRedirectUrl,
  getSlackSigningSecret,
  isSlackAppConfigured,
  SLACK_AUTHORIZE_URL,
  SLACK_BOT_SCOPES,
} from '@/lib/slack/config'
import { signOAuthState } from '@/lib/slack/oauth-state'

/** Best-effort chmonitor owner ref for this install. */
async function resolveOwnerRef(request: Request): Promise<string> {
  try {
    const provider = getAuthProvider()
    if (provider === 'none') return 'default'
    const result =
      await resolveServerAuthProvider(provider).authenticateRequest(request)
    return result.authenticated && result.subject ? result.subject : 'default'
  } catch {
    return 'default'
  }
}

async function handleGet(request: Request): Promise<Response> {
  if (!isSlackAppConfigured()) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }

  const clientId = getSlackClientId()
  const signingSecret = getSlackSigningSecret()
  // isSlackAppConfigured() guarantees both, but narrow for the type-checker.
  if (!clientId || !signingSecret) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }

  const ownerRef = await resolveOwnerRef(request)
  const state = await signOAuthState(signingSecret, ownerRef)

  const url = new URL(SLACK_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', SLACK_BOT_SCOPES.join(','))
  url.searchParams.set('redirect_uri', getSlackOAuthRedirectUrl(request))
  url.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  })
}

export const Route = createFileRoute('/api/v1/slack/install')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests }
