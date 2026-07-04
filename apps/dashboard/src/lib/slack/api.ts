/**
 * Slack Web API transport (plans/37).
 *
 * The only outbound calls the Slack app makes. Two classes of destination:
 *  - FIXED first-party hosts we construct ourselves (`slack.com/api/*`) for the
 *    OAuth token exchange and `views.publish` — not attacker-influenced.
 *  - The `response_url` carried IN a Slack interaction payload. That URL is
 *    attacker-influenceable, so before fetching it we (1) require its host to be
 *    Slack-owned (`hooks.slack.com`) and (2) additionally run it through the
 *    shared SSRF guard (`validateHostUrl`) as belt-and-suspenders. This is the
 *    plan's SSRF invariant.
 *
 * SECURITY: tokens are NEVER logged. Errors log status codes / Slack `error`
 * codes only, never request bodies or Authorization headers.
 */

import type { SlackBlock, SlackHomeView } from './blocks'

import { SLACK_API_BASE } from './config'
import { error as logError } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

const FETCH_TIMEOUT_MS = 10_000

/** Slack OAuth `oauth.v2.access` success shape (subset we persist). */
export interface SlackOAuthAccessResult {
  ok: boolean
  error?: string
  access_token?: string
  token_type?: string
  scope?: string
  bot_user_id?: string
  app_id?: string
  team?: { id?: string; name?: string } | null
  authed_user?: { id?: string } | null
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Exchange an OAuth `code` for a workspace bot token via `oauth.v2.access`.
 * Posts to the fixed `slack.com` host. Returns the parsed result; callers must
 * check `.ok` before trusting `.access_token`. Never throws on a Slack-level
 * error (returns `{ ok: false, error }`); only a network failure rejects.
 */
export async function exchangeOAuthCode(params: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<SlackOAuthAccessResult> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  })

  const res = await fetchWithTimeout(`${SLACK_API_BASE}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const json = (await res
    .json()
    .catch(() => null)) as SlackOAuthAccessResult | null
  if (!json) return { ok: false, error: 'invalid_json_from_slack' }
  return json
}

/**
 * Publish a Home tab view for a user via `views.publish`. Uses the workspace
 * bot token. Best-effort: logs and returns false on any failure.
 */
export async function publishHomeView(params: {
  botToken: string
  userId: string
  view: SlackHomeView
}): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${SLACK_API_BASE}/views.publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${params.botToken}`,
      },
      body: JSON.stringify({ user_id: params.userId, view: params.view }),
    })
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      error?: string
    } | null
    if (!json?.ok) {
      logError(
        '[slack-api] views.publish failed',
        new Error(json?.error ?? `status ${res.status}`)
      )
      return false
    }
    return true
  } catch (err) {
    logError('[slack-api] views.publish exception', err)
    return false
  }
}

/**
 * Assert a Slack `response_url` is genuinely Slack-owned before we fetch it.
 * Slack always issues `response_url` values on `hooks.slack.com`. Rejecting
 * anything else stops a forged interaction payload from turning this into an
 * SSRF/arbitrary-POST primitive.
 */
export function isSlackResponseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return (
      parsed.hostname === 'hooks.slack.com' ||
      parsed.hostname.endsWith('.slack.com')
    )
  } catch {
    return false
  }
}

/**
 * POST a message body to an interaction `response_url` (e.g. to replace the
 * original alert message after an ACK). Double-guarded: Slack-host allowlist
 * THEN the shared SSRF guard. Best-effort: logs and returns false on any
 * failure or a non-Slack URL.
 */
export async function postToResponseUrl(
  responseUrl: string,
  body: { replace_original?: boolean; text?: string; blocks?: SlackBlock[] }
): Promise<boolean> {
  if (!isSlackResponseUrl(responseUrl)) {
    logError(
      '[slack-api] refusing non-Slack response_url',
      new Error('response_url host is not Slack-owned')
    )
    return false
  }
  // Belt-and-suspenders: also run the shared SSRF guard (blocks private /
  // metadata targets even if a *.slack.com name somehow resolved internally).
  const ssrfError = await validateHostUrl(responseUrl)
  if (ssrfError) {
    logError(
      '[slack-api] response_url blocked by SSRF guard',
      new Error(ssrfError)
    )
    return false
  }

  try {
    const res = await fetchWithTimeout(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      logError(
        '[slack-api] response_url POST failed',
        new Error(`status ${res.status}`)
      )
      return false
    }
    return true
  } catch (err) {
    logError('[slack-api] response_url POST exception', err)
    return false
  }
}
