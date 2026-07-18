/**
 * Unified server-side channel resolution (feat #2665): the ONE async function
 * the cron sweep calls to get every channel's effective config, with the
 * D1-persisted UI config taking precedence over the env fallback.
 *
 * Precedence, per channel: **D1 config (a saved row) › env fallback**. If an
 * owner has saved a row for a channel it is authoritative (even if incomplete —
 * an incomplete row resolves to `null`, exactly like an incomplete env config);
 * if there is NO row, the env reader (`getServer*Config()`) is used unchanged.
 * With no D1 binding the store returns `[]`, so every channel falls through to
 * env — an env-only deployment behaves byte-identically to before this module.
 *
 * Kept SEPARATE from `server-alert-config.ts` on purpose: this module imports
 * the D1 store (→ `@chm/platform`, a Workers-only virtual module), while
 * `server-alert-config.ts` stays pure `process.env` so its unit tests never
 * need to mock the platform bindings.
 *
 * ## Per-channel field contracts (`target` = non-secret, `secret` = the one secret)
 *
 *   webhook       target.url                              secret —          (url carries its own secret by convention)
 *   healthchecks  target.url                              secret —
 *   email         target.from, target.to (comma-sep)      secret providerUrl (mailgun://KEY@… / sendgrid://KEY / smtp[s]://…)
 *   opsgenie      target.region ('us'|'eu')               secret apiKey
 *   telegram      target.chatId                           secret botToken
 *   ntfy          target.url                              secret token       (optional)
 *   pushover      target.user                             secret token
 *   twilio        target.accountSid, target.from,         secret authToken
 *                 target.to (comma-sep)
 */

import type { EmailConfig } from './adapters/email'
import type {
  AlertChannelConfig,
  AlertConfigChannel,
} from './alert-channel-config-store'
import type {
  AlertChannelId,
  ChannelSettingsMap,
} from './alert-channel-settings'
import type {
  ServerNtfyConfig,
  ServerOpsgenieConfig,
  ServerPushoverConfig,
  ServerTelegramConfig,
  ServerTwilioConfig,
} from './server-alert-config'

import { detectEmailProvider } from './adapters/email'
import { listChannelConfigs } from './alert-channel-config-store'
import {
  getServerChannelSettings,
  getServerEmailConfig,
  getServerHealthchecksUrl,
  getServerNtfyConfig,
  getServerOpsgenieConfig,
  getServerPushoverConfig,
  getServerTelegramConfig,
  getServerTwilioConfig,
} from './server-alert-config'

/** Every channel's effective config after layering D1 over env. */
export interface ResolvedServerChannels {
  /** Legacy global webhook URL (D1 override or `HEALTH_ALERT_WEBHOOK_URL`). */
  webhookUrl: string
  /** healthchecks.io ping URL (D1 override or `HEALTH_ALERT_HEALTHCHECKS_URL`). */
  healthchecksUrl: string
  opsgenie: ServerOpsgenieConfig | null
  email: EmailConfig | null
  telegram: ServerTelegramConfig | null
  ntfy: ServerNtfyConfig | null
  pushover: ServerPushoverConfig | null
  twilio: ServerTwilioConfig | null
  /**
   * Per-channel enabled/minSeverity gate (#2661), env-derived then overridden
   * by any D1 row. `twilio` is excluded (it keeps its own floor inside its
   * config); `browser`/`pagerduty` are not persisted here.
   */
  channelSettings: ChannelSettingsMap
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function buildOpsgenieFromRow(
  row: AlertChannelConfig
): ServerOpsgenieConfig | null {
  const apiKey = row.secret?.trim() || ''
  if (!apiKey) return null
  const region = row.target.region === 'eu' ? 'eu' : 'us'
  return { apiKey, region }
}

function buildEmailFromRow(row: AlertChannelConfig): EmailConfig | null {
  const providerUrl = row.secret?.trim() || ''
  const provider = providerUrl ? detectEmailProvider(providerUrl) : null
  if (!provider) return null
  const from = row.target.from?.trim() || ''
  if (!from) return null
  const to = splitList(row.target.to)
  if (to.length === 0) return null
  return { provider, from, to }
}

function buildTelegramFromRow(
  row: AlertChannelConfig
): ServerTelegramConfig | null {
  const botToken = row.secret?.trim() || ''
  const chatId = row.target.chatId?.trim() || ''
  if (!botToken || !chatId) return null
  return { botToken, chatId }
}

function buildNtfyFromRow(row: AlertChannelConfig): ServerNtfyConfig | null {
  const url = row.target.url?.trim() || ''
  if (!url) return null
  const token = row.secret?.trim() || ''
  return token ? { url, token } : { url }
}

function buildPushoverFromRow(
  row: AlertChannelConfig
): ServerPushoverConfig | null {
  const token = row.secret?.trim() || ''
  const user = row.target.user?.trim() || ''
  if (!token || !user) return null
  return { token, user }
}

function buildTwilioFromRow(
  row: AlertChannelConfig
): ServerTwilioConfig | null {
  // Unlike the other channels, Twilio is not in `channelSettings` (it carries
  // its own severity floor), so a disabled row must null the config out here.
  if (!row.enabled) return null
  const authToken = row.secret?.trim() || ''
  const accountSid = row.target.accountSid?.trim() || ''
  const from = row.target.from?.trim() || ''
  const to = splitList(row.target.to)
  if (!accountSid || !authToken || !from || to.length === 0) return null
  const minSeverity = row.minSeverity === 'warning' ? 'warning' : 'critical'
  return { accountSid, authToken, from, to, minSeverity }
}

/** Env per-channel settings, then overridden by any saved D1 row. */
function mergeChannelSettings(
  rows: readonly AlertChannelConfig[]
): ChannelSettingsMap {
  const out: ChannelSettingsMap = { ...getServerChannelSettings() }
  for (const row of rows) {
    // `twilio` isn't part of the generic gate map (own floor); skip it.
    if (row.channel === 'twilio') continue
    out[row.channel as AlertChannelId] = {
      enabled: row.enabled,
      ...(row.minSeverity ? { minSeverity: row.minSeverity } : {}),
    }
  }
  return out
}

/**
 * Resolve every channel's effective config for the sweep. `ownerId` is the
 * sweep's OSS single-tenant owner (`''`). Never throws — the store is
 * best-effort and every builder falls back to the env reader when no row exists.
 */
export async function resolveServerChannels(
  ownerId = ''
): Promise<ResolvedServerChannels> {
  const rows = await listChannelConfigs(ownerId)
  const byChannel = new Map<AlertConfigChannel, AlertChannelConfig>(
    rows.map((r) => [r.channel, r])
  )
  const row = (c: AlertConfigChannel) => byChannel.get(c)

  const webhookRow = row('webhook')
  const healthchecksRow = row('healthchecks')
  const opsgenieRow = row('opsgenie')
  const emailRow = row('email')
  const telegramRow = row('telegram')
  const ntfyRow = row('ntfy')
  const pushoverRow = row('pushover')
  const twilioRow = row('twilio')

  return {
    webhookUrl: webhookRow
      ? webhookRow.target.url?.trim() || ''
      : process.env.HEALTH_ALERT_WEBHOOK_URL?.trim() || '',
    healthchecksUrl: healthchecksRow
      ? healthchecksRow.target.url?.trim() || ''
      : getServerHealthchecksUrl(),
    opsgenie: opsgenieRow
      ? buildOpsgenieFromRow(opsgenieRow)
      : getServerOpsgenieConfig(),
    email: emailRow ? buildEmailFromRow(emailRow) : getServerEmailConfig(),
    telegram: telegramRow
      ? buildTelegramFromRow(telegramRow)
      : getServerTelegramConfig(),
    ntfy: ntfyRow ? buildNtfyFromRow(ntfyRow) : getServerNtfyConfig(),
    pushover: pushoverRow
      ? buildPushoverFromRow(pushoverRow)
      : getServerPushoverConfig(),
    twilio: twilioRow ? buildTwilioFromRow(twilioRow) : getServerTwilioConfig(),
    channelSettings: mergeChannelSettings(rows),
  }
}
