/**
 * Native Slack app — runtime configuration.
 *
 * The Slack app (OAuth install, /chmonitor slash commands, Home tab, ACK
 * buttons) is entirely OPTIONAL. When its env is absent the feature is simply
 * off: every inbound route fails closed (501/"not configured") and nothing
 * else in the dashboard changes. This mirrors the fail-open posture of the
 * GitHub deploy webhook (lib/deployments/config.ts) — the OSS/self-hosted
 * default runs fine with none of these vars set.
 *
 * All values are read from `process.env`, which the Worker populates from its
 * vars/secrets via the `nodejs_compat_populate_process_env` compat flag (see
 * wrangler.toml) — the same source lib/deployments/config.ts reads. Secrets
 * (`SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) must be provided as Worker
 * secrets / `.env.local` and NEVER committed.
 */

function readEnv(key: string): string | undefined {
  const v = typeof process !== 'undefined' ? process.env?.[key] : undefined
  return v === undefined || v === '' ? undefined : v
}

/** OAuth client id (public — identifies the Slack app during install). */
export function getSlackClientId(): string | undefined {
  return readEnv('SLACK_CLIENT_ID')
}

/** OAuth client secret (SECRET — exchanges the install `code` for a token). */
export function getSlackClientSecret(): string | undefined {
  return readEnv('SLACK_CLIENT_SECRET')
}

/**
 * Signing secret (SECRET) used to verify `X-Slack-Signature` on every inbound
 * Slack request AND to derive the at-rest token-encryption key + the OAuth
 * `state` CSRF signature. Its presence is the single gate for "is the Slack
 * app configured", because no inbound request can be trusted without it.
 */
export function getSlackSigningSecret(): string | undefined {
  return readEnv('SLACK_SIGNING_SECRET')
}

/**
 * Optional dedicated 32-byte (base64) key for encrypting stored bot tokens,
 * independent of the signing secret (set only if you want to rotate it
 * separately). Mirrors CHM_USER_CONNECTIONS_ENCRYPTION_KEY.
 */
export function getSlackTokenEncryptionKey(): string | undefined {
  return readEnv('SLACK_TOKEN_ENCRYPTION_KEY')
}

/**
 * Whether the native Slack app is configured. Requires the three OAuth/verify
 * credentials; anything less leaves the feature off (routes fail closed).
 */
export function isSlackAppConfigured(): boolean {
  return Boolean(
    getSlackClientId() && getSlackClientSecret() && getSlackSigningSecret()
  )
}

/**
 * OAuth scopes requested at install. Kept in sync with docs/slack/manifest.yml.
 * Only scopes the app actually uses:
 *  - commands       : receive the /chmonitor slash command
 *  - chat:write     : post/update alert messages (ACK edit)
 *  - app_mentions:read + the Home tab (`app_home`) come via event subscriptions
 */
export const SLACK_BOT_SCOPES = ['commands', 'chat:write'] as const

/** Slack API base — a fixed, first-party host (not derived from any payload). */
export const SLACK_API_BASE = 'https://slack.com/api'

/** Slack OAuth authorize endpoint. */
export const SLACK_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize'

/** Path of the OAuth redirect (callback) route — the app's registered redirect URI. */
export const SLACK_OAUTH_CALLBACK_PATH = '/api/v1/slack/oauth'

/**
 * The OAuth redirect URI Slack calls back after the user approves the app.
 * Prefer an explicit `SLACK_OAUTH_REDIRECT_URL` (so it exactly matches what is
 * configured in the Slack app), otherwise derive it from the incoming request
 * origin so a self-hoster gets a correct URL with zero extra config.
 */
export function getSlackOAuthRedirectUrl(request: Request): string {
  const explicit = readEnv('SLACK_OAUTH_REDIRECT_URL')
  if (explicit) return explicit
  const origin = new URL(request.url).origin
  return `${origin}${SLACK_OAUTH_CALLBACK_PATH}`
}
