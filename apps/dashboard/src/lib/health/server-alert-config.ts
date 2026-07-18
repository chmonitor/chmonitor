import type { AlertRuleThresholds } from '@/lib/alerting/rule-registry'
import type { EmailConfig } from './adapters/email'
import type {
  AlertChannelId,
  ChannelSettingsMap,
} from './alert-channel-settings'
import type { AlertSettings } from './alert-settings-storage'

import { detectEmailProvider } from './adapters/email'
import { DEFAULT_ALERT_SETTINGS } from './alert-settings-storage'

/**
 * Server-side alert configuration sourced from environment variables.
 *
 * The client persists {@link AlertSettings} in localStorage (tab-scoped); the
 * autonomous cron sweep cannot read that, so it reads the same shape from env:
 *
 *   - HEALTH_ALERT_ENABLED      → webhookEnabled (default false)
 *   - HEALTH_ALERT_WEBHOOK_URL  → webhookUrl     (default '')
 *   - HEALTH_ALERT_MIN_SEVERITY → minSeverity    (default 'warning')
 *
 * Browser notifications never apply server-side, so it is always disabled.
 *
 * ## minSeverity default: intentionally 'warning' (differs from the client)
 *
 * The client default ({@link DEFAULT_ALERT_SETTINGS}) is `'critical'` — a
 * conservative choice so a fresh browser session is not spammed with in-app
 * toasts / OS notifications for every warning. The server sweep default is
 * `'warning'` on purpose: the cron path is an operator-facing *outbound*
 * channel (Slack/Discord webhook) where catching a warning early — before it
 * escalates to critical — is the whole point, and the dedup state store (see
 * `alert-state-store.ts`) already prevents a persistent warning from being
 * re-sent every run. Operators who only want criticals set
 * `HEALTH_ALERT_MIN_SEVERITY=critical`. This difference is deliberate and
 * documented rather than "aligned", per issue #2077.
 */
export function getServerAlertConfig(): AlertSettings {
  const webhookUrl = process.env.HEALTH_ALERT_WEBHOOK_URL?.trim() || ''
  const enabled = process.env.HEALTH_ALERT_ENABLED === 'true'
  const minSeverityEnv = process.env.HEALTH_ALERT_MIN_SEVERITY?.trim()
  const minSeverity: AlertSettings['minSeverity'] =
    minSeverityEnv === 'critical' || minSeverityEnv === 'warning'
      ? minSeverityEnv
      : 'warning'

  return {
    ...DEFAULT_ALERT_SETTINGS,
    webhookUrl,
    webhookEnabled: enabled,
    browserNotificationsEnabled: false,
    minSeverity,
  }
}

/**
 * Server-side email alert configuration, sourced from environment variables:
 *
 *   - HEALTH_ALERT_EMAIL_ENABLED       → boolean (default false)
 *   - HEALTH_ALERT_EMAIL_TO            → comma-separated recipients (default '')
 *   - HEALTH_ALERT_EMAIL_FROM          → from address (default '')
 *   - HEALTH_ALERT_EMAIL_PROVIDER_URL  → mailgun://KEY@DOMAIN | sendgrid://KEY |
 *                                        smtp://user:pass@host:port | smtps://...
 *
 * Returns `null` when disabled or unconfigured — missing/invalid provider URL,
 * no `from` address, or no recipients — so an unconfigured deployment fails
 * OPEN: the sweep behaves exactly as it did before email support existed.
 *
 * The provider transport secret (API key / SMTP credentials) is intentionally
 * NOT part of the returned {@link EmailConfig} — it stays in
 * `HEALTH_ALERT_EMAIL_PROVIDER_URL` and is resolved by the dispatch layer that
 * actually sends the email, mirroring how `buildEmailBody` stays pure.
 *
 * NOTE: exposed as a companion function rather than folded into
 * {@link getServerAlertConfig}'s return value so that function keeps its exact
 * {@link AlertSettings} shape (its unit tests assert the object deeply) —
 * exactly as {@link getServerThresholdOverrides} is a companion today.
 */
export function getServerEmailConfig(): EmailConfig | null {
  const enabled = process.env.HEALTH_ALERT_EMAIL_ENABLED === 'true'
  if (!enabled) return null

  const providerUrl = process.env.HEALTH_ALERT_EMAIL_PROVIDER_URL?.trim() || ''
  const provider = providerUrl ? detectEmailProvider(providerUrl) : null
  if (!provider) return null

  const from = process.env.HEALTH_ALERT_EMAIL_FROM?.trim() || ''
  if (!from) return null

  const to = (process.env.HEALTH_ALERT_EMAIL_TO ?? '')
    .split(',')
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0)
  if (to.length === 0) return null

  return { provider, from, to }
}

/**
 * The env-var prefix for each channel's per-channel override (#2661). `browser`
 * / `healthchecks` are client-only, and `twilio` keeps its own dedicated
 * `HEALTH_ALERT_TWILIO_MIN_SEVERITY` gate (#2668), so neither appears here.
 */
const CHANNEL_ENV_PREFIX: Partial<Record<AlertChannelId, string>> = {
  webhook: 'HEALTH_ALERT_WEBHOOK',
  email: 'HEALTH_ALERT_EMAIL',
  opsgenie: 'HEALTH_ALERT_OPSGENIE',
  pagerduty: 'HEALTH_ALERT_PAGERDUTY',
  telegram: 'HEALTH_ALERT_TELEGRAM',
  ntfy: 'HEALTH_ALERT_NTFY',
  pushover: 'HEALTH_ALERT_PUSHOVER',
}

/**
 * Server-side per-channel alert overrides, sourced from environment variables
 * (#2661) — the sweep's analogue of the client's localStorage
 * `AlertSettings.channels`. For a channel `<CH>`:
 *
 *   HEALTH_ALERT_<CH>_ENABLED       → `false` disables the channel entirely
 *   HEALTH_ALERT_<CH>_MIN_SEVERITY  → 'warning' | 'critical' — this channel's floor
 *
 * Both are optional and default to "inherit" (enabled + the global
 * `HEALTH_ALERT_MIN_SEVERITY`). Only channels with at least one valid override
 * appear in the returned map; an all-inherit deployment gets `{}`, so the sweep
 * behaves exactly as it did before #2661.
 *
 * `HEALTH_ALERT_WEBHOOK_ENABLED` gates ONLY the webhook channel (routes + the
 * legacy global webhook), distinct from the master `HEALTH_ALERT_ENABLED` that
 * turns the whole sweep on/off. For channels that already have a presence gate
 * (e.g. `HEALTH_ALERT_EMAIL_ENABLED` — the master email enable), a `false` here
 * simply agrees with that gate.
 *
 * NOTE: a companion function (like {@link getServerThresholdOverrides}) rather
 * than folded into {@link getServerAlertConfig}'s return value, whose exact
 * {@link AlertSettings} shape is asserted deeply by its tests.
 */
export function getServerChannelSettings(): ChannelSettingsMap {
  const out: ChannelSettingsMap = {}
  for (const [channelId, prefix] of Object.entries(CHANNEL_ENV_PREFIX)) {
    const enabledRaw = process.env[`${prefix}_ENABLED`]?.trim().toLowerCase()
    const minSeverityRaw = process.env[`${prefix}_MIN_SEVERITY`]?.trim()
    const override: {
      enabled?: boolean
      minSeverity?: 'warning' | 'critical'
    } = {}
    if (enabledRaw === 'false') override.enabled = false
    else if (enabledRaw === 'true') override.enabled = true
    if (minSeverityRaw === 'warning' || minSeverityRaw === 'critical') {
      override.minSeverity = minSeverityRaw
    }
    if (override.enabled !== undefined || override.minSeverity !== undefined) {
      out[channelId as AlertChannelId] = override
    }
  }
  return out
}

/** Per-rule threshold override (either bound may be omitted). */
export type ThresholdOverride = Partial<AlertRuleThresholds>

/**
 * Convert a rule id to its env-var prefix: uppercased, dashes → underscores.
 * e.g. `disk-usage` → `HEALTH_THRESHOLD_DISK_USAGE`.
 */
function thresholdEnvPrefix(ruleId: string): string {
  return `HEALTH_THRESHOLD_${ruleId.toUpperCase().replace(/-/g, '_')}`
}

function parseThresholdEnv(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

/**
 * Resolve env-based threshold overrides for the given rule ids.
 *
 * Scheme (documented for operators): for a rule `<rule-id>`, set either or both
 * of
 *
 *   HEALTH_THRESHOLD_<RULE_ID>_WARNING
 *   HEALTH_THRESHOLD_<RULE_ID>_CRITICAL
 *
 * where `<RULE_ID>` is the rule id uppercased with dashes replaced by
 * underscores. Example: raise the disk-usage critical threshold to 90 with
 * `HEALTH_THRESHOLD_DISK_USAGE_CRITICAL=90`. Only finite numeric values are
 * accepted; anything else is ignored (falls back to the rule's defaults).
 *
 * Returned as a partial map keyed by rule id — only rules with at least one
 * override present appear. Callers merge these onto each rule's `defaults`.
 *
 * NOTE: exposed as a companion function rather than folded into
 * {@link getServerAlertConfig}'s return value so that function keeps its exact
 * {@link AlertSettings} shape (its unit tests assert the object deeply).
 */
export function getServerThresholdOverrides(
  ruleIds: readonly string[]
): Record<string, ThresholdOverride> {
  const out: Record<string, ThresholdOverride> = {}
  for (const id of ruleIds) {
    const prefix = thresholdEnvPrefix(id)
    const warning = parseThresholdEnv(process.env[`${prefix}_WARNING`])
    const critical = parseThresholdEnv(process.env[`${prefix}_CRITICAL`])
    if (warning === null && critical === null) continue
    const override: ThresholdOverride = {}
    if (warning !== null) override.warning = warning
    if (critical !== null) override.critical = critical
    out[id] = override
  }
  return out
}

/** Opsgenie region — selects which Alert API base host the dispatch layer uses. */
export type OpsgenieRegion = 'us' | 'eu'

/** Resolved server-side Opsgenie config: the API key plus which region to target. */
export interface ServerOpsgenieConfig {
  apiKey: string
  region: OpsgenieRegion
}

/**
 * Server-side Opsgenie config, sourced from environment variables:
 *
 *   - HEALTH_ALERT_OPSGENIE_API_KEY → apiKey (default '')
 *   - HEALTH_ALERT_OPSGENIE_REGION  → region ('us' | 'eu', default 'us')
 *
 * Returns null when no API key is configured — Opsgenie delivery is opt-in
 * and fails open (no key ⇒ the sweep skips the Opsgenie dispatch entirely).
 *
 * NOTE: exposed as a companion function (matching
 * {@link getServerThresholdOverrides}) rather than folded into
 * {@link getServerAlertConfig}'s return value — that shape is shared with the
 * client's localStorage settings and asserted deeply by its tests, and an
 * Opsgenie API key is a server-only secret that must never round-trip
 * through it.
 */
export function getServerOpsgenieConfig(): ServerOpsgenieConfig | null {
  const apiKey = process.env.HEALTH_ALERT_OPSGENIE_API_KEY?.trim() || ''
  if (!apiKey) return null
  const region: OpsgenieRegion =
    process.env.HEALTH_ALERT_OPSGENIE_REGION?.trim().toLowerCase() === 'eu'
      ? 'eu'
      : 'us'
  return { apiKey, region }
}

/** Resolved server-side Telegram config: the bot token plus the target chat id. */
export interface ServerTelegramConfig {
  botToken: string
  chatId: string
}

/**
 * Server-side Telegram config, sourced from environment variables:
 *
 *   - HEALTH_ALERT_TELEGRAM_BOT_TOKEN → botToken (default '')
 *   - HEALTH_ALERT_TELEGRAM_CHAT_ID   → chatId   (default '')
 *
 * Returns null unless BOTH are configured — Telegram delivery is opt-in and
 * fails open (either value missing ⇒ the sweep skips the Telegram dispatch
 * entirely). This is the global fallback used when no per-rule/per-host
 * Telegram route matches, mirroring the PagerDuty routing-key fallback (#2655).
 *
 * NOTE: exposed as a companion function (matching
 * {@link getServerOpsgenieConfig}) rather than folded into
 * {@link getServerAlertConfig}'s return value — that shape is shared with the
 * client's localStorage settings and asserted deeply by its tests, and the bot
 * token is a server-only secret that must never round-trip through it.
 */
export function getServerTelegramConfig(): ServerTelegramConfig | null {
  const botToken = process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN?.trim() || ''
  const chatId = process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID?.trim() || ''
  if (!botToken || !chatId) return null
  return { botToken, chatId }
}

/** Resolved server-side ntfy config: the topic URL plus an optional token. */
export interface ServerNtfyConfig {
  /** Full topic URL, e.g. `https://ntfy.sh/my-topic` (may be self-hosted). */
  url: string
  /** Optional access token for a protected topic (`Authorization: Bearer …`). */
  token?: string
}

/**
 * Server-side ntfy config, sourced from environment variables:
 *
 *   - HEALTH_ALERT_NTFY_URL   → url    (full topic URL, default '')
 *   - HEALTH_ALERT_NTFY_TOKEN → token  (optional Bearer token, default unset)
 *
 * Returns null unless the URL is configured — ntfy delivery is opt-in and
 * fails open (no URL ⇒ the sweep skips the ntfy dispatch entirely). This is the
 * global fallback used when no per-rule/per-host ntfy route matches, mirroring
 * the Telegram fallback (#2655).
 *
 * NOTE: exposed as a companion function (matching {@link getServerTelegramConfig})
 * rather than folded into {@link getServerAlertConfig}'s return value — that
 * shape is shared with the client's localStorage settings and asserted deeply
 * by its tests, and the ntfy token is a server-only secret that must never
 * round-trip through it.
 */
export function getServerNtfyConfig(): ServerNtfyConfig | null {
  const url = process.env.HEALTH_ALERT_NTFY_URL?.trim() || ''
  if (!url) return null
  const token = process.env.HEALTH_ALERT_NTFY_TOKEN?.trim() || ''
  return token ? { url, token } : { url }
}

/**
 * Resolved server-side Twilio SMS config: credentials, sender, recipients,
 * and this channel's own severity floor.
 */
export interface ServerTwilioConfig {
  accountSid: string
  authToken: string
  from: string
  /** SMS recipients (E.164 numbers) — one POST per number. */
  to: string[]
  /** Minimum severity that triggers an SMS. Default `'critical'` — see below. */
  minSeverity: 'warning' | 'critical'
}

/**
 * Server-side Twilio config, sourced from environment variables:
 *
 *   - HEALTH_ALERT_TWILIO_ACCOUNT_SID  → accountSid  (default '')
 *   - HEALTH_ALERT_TWILIO_AUTH_TOKEN   → authToken   (default '') — secret, server-only
 *   - HEALTH_ALERT_TWILIO_FROM         → from        (default '')
 *   - HEALTH_ALERT_TWILIO_TO           → to          (comma-separated, default '')
 *   - HEALTH_ALERT_TWILIO_MIN_SEVERITY → minSeverity ('warning' | 'critical', default 'critical')
 *
 * Returns null unless the account SID, auth token, `from` number, and at
 * least one recipient are ALL configured — Twilio delivery is opt-in and
 * fails open (any missing piece ⇒ the sweep skips the Twilio dispatch
 * entirely).
 *
 * SMS is a last-resort paging channel that costs real money per message, so
 * — unlike every other channel here — it defaults its OWN severity floor to
 * `'critical'` rather than only following the global `HEALTH_ALERT_MIN_SEVERITY`
 * gate: a warning that clears the global gate still will not page a phone
 * unless the operator explicitly opts in with
 * `HEALTH_ALERT_TWILIO_MIN_SEVERITY=warning` (per issue #2668; a generic
 * per-channel severity setting for every channel is tracked separately in
 * #2661).
 *
 * NOTE: exposed as a companion function (matching {@link getServerTelegramConfig})
 * rather than folded into {@link getServerAlertConfig}'s return value — that
 * shape is shared with the client's localStorage settings and asserted deeply
 * by its tests, and the Twilio auth token is a server-only secret that must
 * never round-trip through it.
 */
export function getServerTwilioConfig(): ServerTwilioConfig | null {
  const accountSid = process.env.HEALTH_ALERT_TWILIO_ACCOUNT_SID?.trim() || ''
  const authToken = process.env.HEALTH_ALERT_TWILIO_AUTH_TOKEN?.trim() || ''
  const from = process.env.HEALTH_ALERT_TWILIO_FROM?.trim() || ''
  const to = (process.env.HEALTH_ALERT_TWILIO_TO ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0)
  if (!accountSid || !authToken || !from || to.length === 0) return null

  const minSeverityEnv = process.env.HEALTH_ALERT_TWILIO_MIN_SEVERITY?.trim()
  const minSeverity: 'warning' | 'critical' =
    minSeverityEnv === 'warning' ? 'warning' : 'critical'

  return { accountSid, authToken, from, to, minSeverity }
}

/** Resolved server-side Pushover config: the app token plus the target user/group key. */
export interface ServerPushoverConfig {
  token: string
  user: string
}

/**
 * Server-side Pushover config, sourced from environment variables:
 *
 *   - HEALTH_ALERT_PUSHOVER_TOKEN → token (application API token, default '')
 *   - HEALTH_ALERT_PUSHOVER_USER  → user  (target user/group key, default '')
 *
 * Returns null unless BOTH are configured — Pushover delivery is opt-in and
 * fails open (either value missing ⇒ the sweep skips the Pushover dispatch
 * entirely). This is the global fallback used when no per-rule/per-host
 * Pushover route matches, mirroring the Telegram fallback (#2655, #2659).
 *
 * NOTE: exposed as a companion function (matching
 * {@link getServerTelegramConfig}) rather than folded into
 * {@link getServerAlertConfig}'s return value — that shape is shared with the
 * client's localStorage settings and asserted deeply by its tests, and the
 * app token is a server-only secret that must never round-trip through it.
 */
export function getServerPushoverConfig(): ServerPushoverConfig | null {
  const token = process.env.HEALTH_ALERT_PUSHOVER_TOKEN?.trim() || ''
  const user = process.env.HEALTH_ALERT_PUSHOVER_USER?.trim() || ''
  if (!token || !user) return null
  return { token, user }
}

/**
 * Server-side healthchecks.io ping URL, sourced from
 * `HEALTH_ALERT_HEALTHCHECKS_URL` (default '').
 *
 * healthchecks.io was client-only until #2665 (the browser fired the ping); the
 * cron sweep now dispatches it too, so it needs an env fallback like every other
 * channel. Returns '' when unset — the sweep then skips the healthchecks ping
 * entirely (fail-open). The D1 unified config (`resolveServerChannels`) overrides
 * this when an operator saves a healthchecks URL from the UI.
 */
export function getServerHealthchecksUrl(): string {
  return process.env.HEALTH_ALERT_HEALTHCHECKS_URL?.trim() || ''
}

/**
 * Time-window digest mode (#2663), sourced from `HEALTH_ALERT_DIGEST_MINUTES`.
 *
 * `0`/unset/invalid ⇒ off: findings dispatch this sweep tick (with in-pass
 * grouping still applied). A positive value buffers NON-critical findings and
 * flushes them once the window elapses, so a burst collapses into one message —
 * criticals always bypass the buffer. The UI (D1) setting overrides this env
 * value via `resolveDigestWindowMinutes` (`alert-digest-settings-store.ts`).
 */
export function getServerDigestWindowMinutes(): number {
  const raw = process.env.HEALTH_ALERT_DIGEST_MINUTES?.trim()
  if (raw === undefined || raw === '') return 0
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes < 0) return 0
  return Math.floor(minutes)
}

/** Default cron re-notify cooldown, in minutes, when the env var is unset. */
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 60

/**
 * Re-notify cooldown for a persistent condition, in milliseconds.
 *
 * `HEALTH_ALERT_COOLDOWN_MINUTES` (default 60) controls how long the sweep waits
 * before re-sending a webhook for a condition that stays at the same severity.
 * `0` disables reminders entirely (a persistent condition alerts once until it
 * escalates or recovers). Invalid / negative values fall back to the default.
 */
export function getServerAlertCooldownMs(): number {
  const raw = process.env.HEALTH_ALERT_COOLDOWN_MINUTES?.trim()
  if (raw === undefined || raw === '') {
    return DEFAULT_ALERT_COOLDOWN_MINUTES * 60 * 1000
  }
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes < 0) {
    return DEFAULT_ALERT_COOLDOWN_MINUTES * 60 * 1000
  }
  return minutes * 60 * 1000
}
