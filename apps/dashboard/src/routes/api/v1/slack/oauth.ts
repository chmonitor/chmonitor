/**
 * GET /api/v1/slack/oauth — Slack OAuth redirect (callback) URI.
 *
 * The URL registered as the app's Redirect URL in the Slack app config. Slack
 * sends the browser here after the user approves the install, with `?code` and
 * the `?state` we issued at /api/v1/slack/install.
 *
 * Flow: verify `state` (CSRF — Slack does NOT sign this redirect, so state is
 * the only defense) → exchange `code` for a workspace bot token via
 * oauth.v2.access → persist the ENCRYPTED token in D1, bound to the owner ref
 * carried in the (signed, tamper-proof) state. Never logs the code or token.
 *
 * Fails closed: 501 when the Slack app is unconfigured. A denied consent, a
 * bad/expired state, or a failed exchange render a small self-contained result
 * page (no dependency on a dashboard UI route) rather than leaking detail.
 */

import { createFileRoute } from '@tanstack/react-router'

import { error as logError } from '@chm/logger'
import { exchangeOAuthCode } from '@/lib/slack/api'
import {
  getSlackClientId,
  getSlackClientSecret,
  getSlackOAuthRedirectUrl,
  getSlackSigningSecret,
  isSlackAppConfigured,
} from '@/lib/slack/config'
import { upsertInstallation } from '@/lib/slack/install-store'
import { verifyOAuthState } from '@/lib/slack/oauth-state'

/** Minimal self-contained result page (success or failure). */
function resultPage(title: string, message: string, ok: boolean): Response {
  const color = ok ? '#16a34a' : '#dc2626'
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center"><h1 style="color:${color}">${title}</h1><p style="color:#475569">${message}</p></body></html>`
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

async function handleGet(request: Request): Promise<Response> {
  if (!isSlackAppConfigured()) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }

  const clientId = getSlackClientId()
  const clientSecret = getSlackClientSecret()
  const signingSecret = getSlackSigningSecret()
  if (!clientId || !clientSecret || !signingSecret) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }

  const { searchParams } = new URL(request.url)

  // User denied consent (or Slack reported an error) — no code to exchange.
  const oauthError = searchParams.get('error')
  if (oauthError) {
    return resultPage(
      'Slack install cancelled',
      'The installation was not completed. You can close this window.',
      false
    )
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')

  // CSRF: verify the signed state BEFORE doing anything with the code.
  const verified = await verifyOAuthState(signingSecret, state)
  if (!verified) {
    logError('[slack-oauth] rejected: invalid/expired state')
    return resultPage(
      'Slack install failed',
      'This install link is invalid or has expired. Please start again from chmonitor.',
      false
    )
  }

  if (!code) {
    return resultPage(
      'Slack install failed',
      'Missing authorization code. Please start again from chmonitor.',
      false
    )
  }

  const redirectUri = getSlackOAuthRedirectUrl(request)
  let access
  try {
    access = await exchangeOAuthCode({
      clientId,
      clientSecret,
      code,
      redirectUri,
    })
  } catch (err) {
    logError('[slack-oauth] token exchange network failure', err)
    return resultPage(
      'Slack install failed',
      'Could not reach Slack to complete the install. Please try again.',
      false
    )
  }

  if (!access.ok || !access.access_token || !access.team?.id) {
    // Log Slack's error CODE only (never the code/token).
    logError(
      '[slack-oauth] token exchange rejected',
      new Error(access.error ?? 'unknown_slack_error')
    )
    return resultPage(
      'Slack install failed',
      'Slack rejected the installation. Please try again.',
      false
    )
  }

  const now = Date.now()
  const stored = await upsertInstallation({
    teamId: access.team.id,
    teamName: access.team.name ?? null,
    botToken: access.access_token,
    botUserId: access.bot_user_id ?? null,
    scope: access.scope ?? null,
    authedUserId: access.authed_user?.id ?? null,
    ownerRef: verified.ownerRef,
    installedAt: now,
    updatedAt: now,
  })

  if (!stored) {
    // Persistence failed (no D1, or encryption misconfigured) — an install we
    // can't store is useless, so tell the user instead of faking success.
    return resultPage(
      'Slack install incomplete',
      'chmonitor could not save the Slack connection. Ensure D1 storage is configured, then try again.',
      false
    )
  }

  return resultPage(
    'chmonitor connected to Slack',
    'You can now use /chmonitor in your workspace. You can close this window.',
    true
  )
}

export const Route = createFileRoute('/api/v1/slack/oauth')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests }
