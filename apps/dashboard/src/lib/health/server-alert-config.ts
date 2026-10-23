import type { AlertRuleThresholds } from '@/lib/alerting/rule-registry'
import type { EmailConfig } from './adapters/email'
import type {
  AlertChannelId,
  ChannelSettingsMap,
} from './alert-channel-settings'
import type { AlertSettings } from './alert-settings-storage'

import { detectEmailProvider } from './adapters/email'
import { DEFAULT_ALERT_SETTINGS } from './alert-settings-storage'
import {
  isValidMatrixRoomId,
  parseMatrixHomeserverUrl,
} from './matrix-dispatch'
import { getPagerDutyFallbackRoutingKey } from './pagerduty-config'
import { warn } from '@chm/logger'

/**
 * Lenient env boolean: true/1/yes/on and false/0/no/off (case-insensitive).
 * Returns `undefined` for unset/empty/unrecognised values so callers can
 * apply their own default.
 */
function parseEnvBool(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return undefined
}

/**
 * Server-side alert configuration sourced from environment variables.
 *
 * The client persists {@link AlertSettings} in localStorage (tab-scoped); the
 * autonomous cron sweep cannot read that, so it reads the same shape from env:
 *
 *   - HEALTH_ALERT_ENABLED      → webhookEnabled (default: on iff the webhook
 *                                 URL is set; explicit false/0/no/off disables).
 *                                 The sweep's overall gate is {@link isAnyAlertChannelEnabled}.
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
  // Optional flag: unset → on when a webhook URL is configured.
  const enabled = parseEnvBool(process.env.HEALTH_ALERT_ENABLED) ?? !!webhookUrl
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
 *   - HEALTH_ALERT_EMAIL_ENABLED       → optional boolean; defaults on once the
 *                                        settings below are present, false/0/no/off disables
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
  // Optional flag: only an explicit false-like value disables; the checks
  // below decide whether the channel is configured at all.
  if (parseEnvBool(process.env.HEALTH_ALERT_EMAIL_ENABLED) === false) {
    return null
  }

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
  matrix: 'HEALTH_ALERT_MATRIX',
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
    const enabled = parseEnvBool(process.env[`${prefix}_ENABLED`])
    const minSeverityRaw = process.env[`${prefix}_MIN_SEVERITY`]?.trim()
    const override: {
      enabled?: boolean
      minSeverity?: 'warning' | 'critical'
    } = {}
    if (enabled !== undefined) override.enabled = enabled
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

/** Resolved server-side native Matrix config: homeserver, token, room. */
export interface ServerMatrixConfig {
  /** Homeserver base URL, e.g. `https://matrix.example.org`. */
  homeserverUrl: string
  /** Access token of the bot user (`Authorization: Bearer …`). A secret. */
  accessToken: string
  /** Room id (`!…`), not an alias. */
  roomId: string
}

const warnedMatrixProblems = new Set<string>()

/** Test hook: forget which Matrix config problems were already logged. */
export function __resetMatrixConfigWarningsForTests(): void {
  warnedMatrixProblems.clear()
}

/**
 * Server-side native Matrix config, sourced from environment variables:
 *
 *   - HEALTH_ALERT_MATRIX_HOMESERVER_URL → homeserverUrl (http/https)
 *   - HEALTH_ALERT_MATRIX_ACCESS_TOKEN   → accessToken
 *   - HEALTH_ALERT_MATRIX_ROOM_ID        → roomId (`!…`)
 *
 * Returns null unless all three are set and valid (a set-but-invalid value logs one warning, never the token) — opt-in, fails open. The
 * env URL is operator-set and trusted, so a LAN homeserver is allowed here
 * (a URL saved from the UI goes through the SSRF guard instead). Like the
 * ntfy token, the access token never joins {@link getServerAlertConfig}.
 */
export function getServerMatrixConfig(): ServerMatrixConfig | null {
  const homeserverUrl =
    process.env.HEALTH_ALERT_MATRIX_HOMESERVER_URL?.trim() || ''
  const accessToken = process.env.HEALTH_ALERT_MATRIX_ACCESS_TOKEN?.trim() || ''
  const roomId = process.env.HEALTH_ALERT_MATRIX_ROOM_ID?.trim() || ''
  if (!homeserverUrl || !accessToken || !roomId) return null
  const normalized = parseMatrixHomeserverUrl(homeserverUrl, {
    allowHttp: true,
  })
  const problem = !normalized
    ? 'HEALTH_ALERT_MATRIX_HOMESERVER_URL must be an http(s) URL without credentials, query or fragment'
    : !isValidMatrixRoomId(roomId)
      ? 'HEALTH_ALERT_MATRIX_ROOM_ID must be a room id like !abc:example.org, not an alias'
      : null
  if (problem || !normalized) {
    if (problem && !warnedMatrixProblems.has(problem)) {
      warnedMatrixProblems.add(problem)
      warn(`[health-config] Matrix alerts not configured: ${problem}`)
    }
    return null
  }
  return { homeserverUrl: normalized, accessToken, roomId }
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

/**
 * Per-check hysteresis config (anti-flap, #2767): how many consecutive sweeps a
 * worsening must persist before it fires, and how many consecutive `ok` sweeps a
 * firing condition needs before it recovers.
 */
export interface HysteresisConfig {
  minConsecutiveBreaches: number
  minConsecutiveClears: number
}

/**
 * Product default hysteresis: fire promptly (1 breach — no delay on a genuine
 * critical) but damp recovery (2 consecutive clears), so a metric flapping
 * around a threshold fires once and recovers once instead of on every dip. This
 * is the sweep's default; the pure {@link import('./alert-state-store')} engine
 * itself defaults to 1/1 (no hysteresis) so its transitions stay unchanged
 * unless a caller opts in.
 */
export const DEFAULT_HYSTERESIS: HysteresisConfig = {
  minConsecutiveBreaches: 1,
  minConsecutiveClears: 2,
}

function parsePositiveIntEnv(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  if (!Number.isFinite(num) || num < 1) return null
  return Math.floor(num)
}

/**
 * Resolve hysteresis config for the given rule ids from environment variables.
 *
 * Global defaults (override {@link DEFAULT_HYSTERESIS}):
 *
 *   HEALTH_HYSTERESIS_BREACHES  → minConsecutiveBreaches
 *   HEALTH_HYSTERESIS_CLEARS    → minConsecutiveClears
 *
 * Per-rule overrides (highest precedence), where `<RULE_ID>` is the rule id
 * uppercased with dashes replaced by underscores:
 *
 *   HEALTH_HYSTERESIS_<RULE_ID>_BREACHES
 *   HEALTH_HYSTERESIS_<RULE_ID>_CLEARS
 *
 * Only finite integers ≥ 1 are accepted; anything else falls back to the next
 * level down. Returns the resolved default plus a fully-resolved config for
 * every requested rule id, so the sweep can look up `byRule[id] ?? defaults`.
 */
export function getServerHysteresisConfig(ruleIds: readonly string[]): {
  defaults: HysteresisConfig
  byRule: Record<string, HysteresisConfig>
} {
  const defaults: HysteresisConfig = {
    minConsecutiveBreaches:
      parsePositiveIntEnv(process.env.HEALTH_HYSTERESIS_BREACHES) ??
      DEFAULT_HYSTERESIS.minConsecutiveBreaches,
    minConsecutiveClears:
      parsePositiveIntEnv(process.env.HEALTH_HYSTERESIS_CLEARS) ??
      DEFAULT_HYSTERESIS.minConsecutiveClears,
  }

  const byRule: Record<string, HysteresisConfig> = {}
  for (const id of ruleIds) {
    const prefix = `HEALTH_HYSTERESIS_${id.toUpperCase().replace(/-/g, '_')}`
    byRule[id] = {
      minConsecutiveBreaches:
        parsePositiveIntEnv(process.env[`${prefix}_BREACHES`]) ??
        defaults.minConsecutiveBreaches,
      minConsecutiveClears:
        parsePositiveIntEnv(process.env[`${prefix}_CLEARS`]) ??
        defaults.minConsecutiveClears,
    }
  }
  return { defaults, byRule }
}

/** Default cron re-notify cooldown, in minutes, when the env var is unset. */
export const DEFAULT_ALERT_COOLDOWN_MINUTES = 60

function parseCooldownMinutesEnv(value: string | undefined): number | null {
  const raw = value?.trim()
  if (raw === undefined || raw === '') return null
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes < 0) return null
  return minutes
}

/**
 * Re-notify cooldown for a persistent condition, in milliseconds, resolved
 * for the given rule ids.
 *
 * `HEALTH_ALERT_COOLDOWN_MINUTES` (default 60) controls how long the sweep waits
 * before re-sending a webhook for a condition that stays at the same severity.
 * `0` disables reminders entirely (a persistent condition alerts once until it
 * escalates or recovers). Invalid / negative values fall back to the default.
 *
 * Precedence (most specific wins): per-rule
 * `HEALTH_ALERT_COOLDOWN_<RULE_ID>_MINUTES` (#3869; id uppercased, dashes →
 * underscores) > per-severity `HEALTH_ALERT_COOLDOWN_CRITICAL_MINUTES` /
 * `HEALTH_ALERT_COOLDOWN_WARNING_MINUTES` (#4049) > global
 * `HEALTH_ALERT_COOLDOWN_MINUTES`. `0` is allowed at every level; invalid /
 * negative values count as unset and fall through to the next level.
 *
 * `byRule` and `bySeverity` hold ONLY explicit overrides, in ms. The caller
 * picks the severity of the alert being evaluated, then resolves
 * `byRule` > `bySeverity[severity]` > `defaultMs`. The severity cannot be
 * folded in here because it changes between sweeps (escalation).
 */
export function getServerAlertCooldownConfig(ruleIds: readonly string[]): {
  defaultMs: number
  bySeverity: Partial<Record<'warning' | 'critical', number>>
  byRule: Record<string, number>
} {
  const defaultMinutes =
    parseCooldownMinutesEnv(process.env.HEALTH_ALERT_COOLDOWN_MINUTES) ??
    DEFAULT_ALERT_COOLDOWN_MINUTES
  const defaultMs = defaultMinutes * 60 * 1000

  const bySeverity: Partial<Record<'warning' | 'critical', number>> = {}
  const criticalMinutes = parseCooldownMinutesEnv(
    process.env.HEALTH_ALERT_COOLDOWN_CRITICAL_MINUTES
  )
  if (criticalMinutes !== null) bySeverity.critical = criticalMinutes * 60_000
  const warningMinutes = parseCooldownMinutesEnv(
    process.env.HEALTH_ALERT_COOLDOWN_WARNING_MINUTES
  )
  if (warningMinutes !== null) bySeverity.warning = warningMinutes * 60_000

  const byRule: Record<string, number> = {}
  for (const id of ruleIds) {
    const key = `HEALTH_ALERT_COOLDOWN_${id.toUpperCase().replace(/-/g, '_')}_MINUTES`
    const minutes = parseCooldownMinutesEnv(process.env[key])
    if (minutes !== null) byRule[id] = minutes * 60 * 1000
  }
  return { defaultMs, bySeverity, byRule }
}

/**
 * Opt-in daily digest of long-firing alerts (#4049):
 * `HEALTH_ALERT_LONG_FIRING_DIGEST_HOURS`. An alert open at least this many
 * hours is listed in one summary message per day per channel. Unset (the
 * default), empty, invalid, zero or negative = `null` (off).
 */
export function getServerLongFiringDigestMs(): number | null {
  const raw = process.env.HEALTH_ALERT_LONG_FIRING_DIGEST_HOURS?.trim()
  if (raw === undefined || raw === '') return null
  const hours = Number(raw)
  if (!Number.isFinite(hours) || hours <= 0) return null
  return hours * 3_600_000
}

function parseMinDeltaEnv(value: string | undefined): number | null {
  const raw = value?.trim()
  if (raw === undefined || raw === '') return null
  const delta = Number(raw)
  if (!Number.isFinite(delta) || delta < 0) return null
  return delta
}

/**
 * Cap, in ms, for back-off of repeat reminders while a value stays flat
 * (#4049): `HEALTH_ALERT_BACKOFF_MAX_MINUTES`. Unset (the default), empty,
 * invalid, zero or negative = `null` (off, fixed cooldown as before).
 */
export function getServerRepeatBackoffMaxMs(): number | null {
  const raw = process.env.HEALTH_ALERT_BACKOFF_MAX_MINUTES?.trim()
  if (raw === undefined || raw === '') return null
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return minutes * 60_000
}

/**
 * Minimum absolute value change needed for a REMINDER to be sent (#4049).
 *
 * `HEALTH_ALERT_REPEAT_MIN_DELTA` is the global value; unset (the default) =
 * off, every reminder is sent as before. Per-rule override:
 * `HEALTH_ALERT_REPEAT_MIN_DELTA_<RULE_ID>` (uppercased, dashes → underscores).
 * Invalid / negative values count as unset. `byRule` holds the resolved value
 * (override, else global) with `null` meaning off.
 */
export function getServerRepeatMinDeltaConfig(ruleIds: readonly string[]): {
  default: number | null
  byRule: Record<string, number | null>
} {
  const defaultDelta = parseMinDeltaEnv(
    process.env.HEALTH_ALERT_REPEAT_MIN_DELTA
  )
  const byRule: Record<string, number | null> = {}
  for (const id of ruleIds) {
    const key = `HEALTH_ALERT_REPEAT_MIN_DELTA_${id.toUpperCase().replace(/-/g, '_')}`
    byRule[id] = parseMinDeltaEnv(process.env[key]) ?? defaultDelta
  }
  return { default: defaultDelta, byRule }
}

/** Comma-separated env list of rule ids / `*`/`?` globs; empty entries dropped. */
function parseRuleIdList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/**
 * Rule ids (or `*`/`?` globs) whose notifications are muted on every channel
 * (#3869): `HEALTH_ALERT_MUTED_RULES`, comma-separated. The rules still run
 * and their findings are still collected; only delivery is skipped.
 */
export function getServerMutedRules(): string[] {
  return parseRuleIdList(process.env.HEALTH_ALERT_MUTED_RULES)
}

/**
 * Rule ids (or `*`/`?` globs) that opt in rules shipped with
 * `defaultEnabled: false` (#4070): `HEALTH_ALERT_ENABLE_RULES`,
 * comma-separated, empty by default. Unlike muting, a rule that is not opted
 * in does not run at all.
 */
export function getServerEnabledRules(): string[] {
  return parseRuleIdList(process.env.HEALTH_ALERT_ENABLE_RULES)
}

/**
 * Rule ids (or `*`/`?` globs) of signal-only rules that should still be
 * delivered to channels: `HEALTH_ALERT_NOTIFY_RULES`, comma-separated, empty
 * by default. A signal-only rule (e.g. `long-running-queries`) is shown on
 * /health and feeds compound rules, but pages only when named here.
 */
export function getServerNotifyRules(): string[] {
  return parseRuleIdList(process.env.HEALTH_ALERT_NOTIFY_RULES)
}

/**
 * The static prefix of a rule id: everything before the first `:` (#4029).
 *
 * `peerdb-mirror-health:pg-to-ch-orders` → `peerdb-mirror-health`. An env var
 * name cannot contain a colon, so a PARAMETERISED rule id has no per-id env
 * var of its own and always resolves through its base. An id with no colon is
 * returned unchanged.
 */
export function perRuleEnvBaseId(ruleId: string): string {
  const colon = ruleId.indexOf(':')
  return colon === -1 ? ruleId : ruleId.slice(0, colon)
}

/**
 * Look up a per-rule setting for a DISPATCHED rule id, falling back to the
 * static base id (#4029) and then to the caller's global default.
 *
 * Exact id first, so an operator who ever gets a colon-free id keeps the
 * precise knob; base second, so `HEALTH_HYSTERESIS_PEERDB_MIRROR_HEALTH_BREACHES`
 * covers every `peerdb-mirror-health:<mirror>` dispatched by the PeerDB cycle.
 * Ids with no base entry (`custom:…`, compound rules) are unchanged: they keep
 * using the global value, exactly as documented.
 */
export function resolvePerRuleOverride<T>(
  byRule: Readonly<Record<string, T>>,
  ruleId: string,
  globalDefault: T
): T {
  const exact = byRule[ruleId]
  if (exact !== undefined) return exact
  const base = byRule[perRuleEnvBaseId(ruleId)]
  return base !== undefined ? base : globalDefault
}

/**
 * How long a failed `GET /v1/mirrors/list` must persist before the PeerDB
 * API-health finding escalates from `warning` to `critical`
 * (`HEALTH_PEERDB_API_CRITICAL_AFTER_MINUTES`, #4029).
 *
 * Default `0` = escalate on the first failed sweep, which is the behaviour
 * that shipped before the variable existed. A positive value keeps the finding
 * at `warning` until the failure has lasted that long, so a single dropped or
 * stalled request produces a self-resolving warning instead of a page; a real
 * outage still reaches `critical` once the threshold elapses.
 *
 * `0`/unset/unparseable/negative → `0` (immediate critical).
 */
export function getPeerDBApiCriticalAfterMs(): number {
  const raw = process.env.HEALTH_PEERDB_API_CRITICAL_AFTER_MINUTES?.trim()
  if (!raw) return 0
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.floor(minutes) * 60_000
}

/**
 * Whether the sweep should dispatch alerts at all (env-resolved): true when
 * ANY channel is configured and not disabled, so `HEALTH_ALERT_ENABLED` is
 * optional. An explicit false-like `HEALTH_ALERT_ENABLED` is the master off
 * switch; an explicit true forces dispatch on, as before. Nothing configured
 * → false (the sweep stays in dry-run/audit mode).
 */
export function isAnyAlertChannelEnabled(): boolean {
  const master = parseEnvBool(process.env.HEALTH_ALERT_ENABLED)
  if (master !== undefined) return master

  const channelSettings = getServerChannelSettings()
  const on = (id: AlertChannelId, configured: boolean) =>
    configured && channelSettings[id]?.enabled !== false
  return (
    on('webhook', Boolean(getServerAlertConfig().webhookUrl)) ||
    on('email', getServerEmailConfig() !== null) ||
    on('opsgenie', getServerOpsgenieConfig() !== null) ||
    on('pagerduty', Boolean(getPagerDutyFallbackRoutingKey())) ||
    on('telegram', getServerTelegramConfig() !== null) ||
    on('ntfy', getServerNtfyConfig() !== null) ||
    on('pushover', getServerPushoverConfig() !== null) ||
    on('matrix', getServerMatrixConfig() !== null) ||
    // Twilio has no per-channel toggle, so configured means on.
    getServerTwilioConfig() !== null ||
    on('healthchecks', Boolean(getServerHealthchecksUrl()))
  )
}

/** Deployment identity stamped onto every outbound alert (instance, link, metadata). */
export interface ServerAlertIdentity {
  /** Deployment label, e.g. `prod-eu`. */
  instanceName?: string
  /** Public dashboard base URL (http/https, no trailing slash). */
  dashboardBaseUrl?: string
  /** Non-secret operator key/values. */
  metadata?: Readonly<Record<string, string>>
}

export const MAX_ALERT_METADATA_PAIRS = 10
export const MAX_ALERT_METADATA_VALUE_LENGTH = 128
export const MAX_ALERT_INSTANCE_NAME_LENGTH = 64
const METADATA_KEY_RE = /^[A-Za-z0-9_.-]{1,32}$/

/**
 * Parse `HEALTH_ALERT_METADATA`: `key=value,key2=value2` or a JSON object.
 * Invalid pairs (bad key, empty or >128-char value, CR/LF, non-string JSON
 * value) are dropped; at most {@link MAX_ALERT_METADATA_PAIRS} pairs are kept.
 */
export function parseAlertMetadata(
  raw: string | undefined
): Record<string, string> | undefined {
  const input = raw?.trim()
  if (!input) return undefined
  let entries: [string, unknown][]
  if (input.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(input)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined
      }
      entries = Object.entries(parsed as Record<string, unknown>)
    } catch {
      return undefined
    }
  } else {
    entries = input.split(',').map((pair): [string, unknown] => {
      const eq = pair.indexOf('=')
      return eq === -1 ? ['', ''] : [pair.slice(0, eq), pair.slice(eq + 1)]
    })
  }
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of entries) {
    if (Object.keys(out).length >= MAX_ALERT_METADATA_PAIRS) break
    if (typeof rawValue !== 'string') continue
    const key = rawKey.trim()
    const value = rawValue.trim()
    if (
      !METADATA_KEY_RE.test(key) ||
      value.length === 0 ||
      value.length > MAX_ALERT_METADATA_VALUE_LENGTH ||
      /[\r\n]/.test(value)
    ) {
      continue
    }
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Accept only an absolute http(s) URL; strip trailing slashes. */
export function parseDashboardBaseUrl(
  raw: string | undefined
): string | undefined {
  const input = raw?.trim()
  if (!input) return undefined
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  // Normalized href: quotes, angle brackets and spaces arrive percent-encoded.
  return url.href.replace(/\/+$/, '')
}

/** Pure parser for {@link getServerAlertIdentity}; exported for tests. */
export function parseAlertIdentity(
  env: Record<string, string | undefined>
): ServerAlertIdentity {
  const identity: ServerAlertIdentity = {}
  const instance = env.HEALTH_ALERT_INSTANCE_NAME?.trim()
  if (
    instance &&
    instance.length <= MAX_ALERT_INSTANCE_NAME_LENGTH &&
    !/[\r\n]/.test(instance)
  ) {
    identity.instanceName = instance
  }
  const base = parseDashboardBaseUrl(env.HEALTH_ALERT_DASHBOARD_URL)
  if (base) identity.dashboardBaseUrl = base
  const metadata = parseAlertMetadata(env.HEALTH_ALERT_METADATA)
  if (metadata) identity.metadata = metadata
  return identity
}

/**
 * Deployment identity for outbound alerts, sourced from environment variables:
 *
 *   - HEALTH_ALERT_INSTANCE_NAME → instanceName (label shown in every message)
 *   - HEALTH_ALERT_DASHBOARD_URL → dashboardBaseUrl (alerts deep-link to
 *                                  `<base>/health?host=<id>`; the cron sweep has
 *                                  no request origin, so env is the source)
 *   - HEALTH_ALERT_METADATA      → metadata (`k=v,k2=v2` or a JSON object)
 *
 * All optional; unset → `{}` and alert bodies are byte-identical to before.
 */
export function getServerAlertIdentity(): ServerAlertIdentity {
  // Named literally so the docs env-var scanner (scripts/gen-docs-data.ts) sees them.
  return parseAlertIdentity({
    HEALTH_ALERT_INSTANCE_NAME: process.env.HEALTH_ALERT_INSTANCE_NAME,
    HEALTH_ALERT_DASHBOARD_URL: process.env.HEALTH_ALERT_DASHBOARD_URL,
    HEALTH_ALERT_METADATA: process.env.HEALTH_ALERT_METADATA,
  })
}

/** Deep link to a host's health page, or undefined without a base URL. */
export function buildHealthDeepLink(
  baseUrl: string | undefined,
  hostId: number
): string | undefined {
  return baseUrl ? `${baseUrl}/health?host=${hostId}` : undefined
}
