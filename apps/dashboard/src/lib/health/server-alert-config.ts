import type { AlertRuleThresholds } from '@/lib/alerting/rule-registry'
import type { EmailConfig } from './adapters/email'
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
