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
 * (`SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`) must be
 * provided as Worker secrets / `.env.local` and NEVER committed.
 */

import { parseSlackChannelId } from './channel-id'
import { ErrorLogger } from '@chm/logger'

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
 * OAuth scopes requested at install. Kept in sync with docs/slack/manifest.yml
 * (config.test.ts checks it). An install keeps the scopes it was granted until
 * it is reinstalled, so every call that needs a newer scope degrades on
 * `missing_scope` instead of failing the alert.
 *  - commands             : receive the /chmonitor slash command
 *  - chat:write           : post/update alert messages (ACK edit)
 *  - chat:write.customize : post alerts under a custom bot name and icon
 *  - reactions:write      : add/remove reactions on alert messages
 *  - app_mentions:read + the Home tab (`app_home`) come via event subscriptions
 */
export const SLACK_BOT_SCOPES = [
  'commands',
  'chat:write',
  'chat:write.customize',
  'reactions:write',
] as const

let warnedBotToken = false

/**
 * Bot token for alerts with no OAuth install (SECRET, `SLACK_BOT_TOKEN`): the
 * `xoxb-` token of a Slack app the operator created and installed by hand.
 * Anything else (a user `xoxp-` token, a webhook URL) is ignored, so alerts
 * never post as a person.
 */
export function getSlackBotToken(): string | undefined {
  const token = readEnv('SLACK_BOT_TOKEN')?.trim()
  if (!token) return undefined
  if (token.startsWith('xoxb-')) return token
  if (!warnedBotToken) {
    warnedBotToken = true
    ErrorLogger.logWarning(
      '[slack-config] SLACK_BOT_TOKEN is not a bot token (xoxb-); ignoring it',
      { component: 'slack-config' }
    )
  }
  return undefined
}

let warnedAlertChannel = false

/**
 * Channel the bot posts alerts to when no alert route matched
 * (`SLACK_ALERT_CHANNEL_ID`, such as `C0123456789`). Used only with
 * `SLACK_BOT_TOKEN`; a route's own channel id always wins. Anything that is not
 * a channel id (a `#name`, a URL) is ignored with one warning.
 */
export function getSlackAlertChannelId(): string | undefined {
  const id = parseSlackChannelId(readEnv('SLACK_ALERT_CHANNEL_ID'))
  if (id !== 'invalid') return id ?? undefined
  if (!warnedAlertChannel) {
    warnedAlertChannel = true
    ErrorLogger.logWarning(
      '[slack-config] SLACK_ALERT_CHANNEL_ID is not a channel id (C…, G… or D…); ignoring it',
      { component: 'slack-config' }
    )
  }
  return undefined
}

/** Display name and icon a bot alert posts under (needs `chat:write.customize`). */
export interface SlackBotIdentity {
  username?: string
  /** Emoji shortcode with colons, e.g. `:rotating_light:`. */
  iconEmoji?: string
}

const MAX_SLACK_BOT_NAME_LENGTH = 80
const SLACK_EMOJI_NAME_RE = /^[a-z0-9_+'-]+$/

/**
 * Optional `SLACK_BOT_NAME` and `SLACK_BOT_ICON_EMOJI`. A multi-line or
 * over-long name and an icon that is not an emoji shortcode are dropped.
 */
export function getSlackBotIdentity(): SlackBotIdentity {
  const identity: SlackBotIdentity = {}
  const name = readEnv('SLACK_BOT_NAME')?.trim()
  if (
    name &&
    name.length <= MAX_SLACK_BOT_NAME_LENGTH &&
    !/[\r\n]/.test(name)
  ) {
    identity.username = name
  }
  const icon = readEnv('SLACK_BOT_ICON_EMOJI')
    ?.trim()
    .replace(/^:(.*):$/, '$1')
  if (icon && SLACK_EMOJI_NAME_RE.test(icon)) identity.iconEmoji = `:${icon}:`
  return identity
}

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
