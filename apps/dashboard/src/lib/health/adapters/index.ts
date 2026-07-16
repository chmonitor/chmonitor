/**
 * Notification adapter registry.
 *
 * Re-exports every pure formatter and the shared types, plus a small registry
 * (`ADAPTERS`) and a `detectAdapter(url)` helper that picks the channel-specific
 * adapter for a webhook URL, falling back to the generic JSON adapter.
 *
 * PURE layer — no transport. A later dispatch slice consumes these to actually
 * send notifications.
 */

export type { DiscordWebhookBody } from './discord'
export type { EmailBody, EmailConfig, EmailProvider } from './email'
export type { GenericJsonBody } from './generic-json'
export type { MSTeamsWebhookBody } from './msteams'
export type { NtfyConfig, NtfyMessage } from './ntfy'
export type {
  OpsgenieConfig,
  OpsgenieCreateBody,
  OpsgeniePriority,
} from './opsgenie'
export type {
  PagerDutyConfig,
  PagerDutyEventBody,
  PagerDutySeverity,
} from './pagerduty'
export type { SlackWebhookBody } from './slack'
export type { TelegramConfig, TelegramSendMessageBody } from './telegram'
export type {
  AlertPayload,
  AlertSeverity,
  NotificationAdapter,
} from './types'

export { buildDiscordBody, discordAdapter } from './discord'
export { buildEmailBody, detectEmailProvider, emailAdapter } from './email'
export { buildGenericJsonBody, genericJsonAdapter } from './generic-json'
export { buildMSTeamsBody, msTeamsAdapter } from './msteams'
export {
  buildNtfyHeaders,
  buildNtfyMessage,
  ntfyAdapter,
  sanitizeHeaderValue,
} from './ntfy'
export { buildOpsgenieBody, opsgenieAdapter, opsgenieAlias } from './opsgenie'
export {
  buildPagerDutyBody,
  pagerDutyAdapter,
  pagerDutyDedupKey,
} from './pagerduty'
export { buildSlackBody, slackAdapter } from './slack'
export {
  buildTelegramBody,
  buildTelegramText,
  escapeMarkdownV2,
  telegramAdapter,
} from './telegram'

import type { AlertPayload, NotificationAdapter } from './types'

import { buildDiscordBody, discordAdapter } from './discord'
import { emailAdapter } from './email'
import { genericJsonAdapter } from './generic-json'
import { buildMSTeamsBody, msTeamsAdapter } from './msteams'
import { opsgenieAdapter } from './opsgenie'
import { pagerDutyAdapter } from './pagerduty'
import { slackAdapter } from './slack'
import { telegramAdapter } from './telegram'

/**
 * Channel-specific adapters, in detection priority order, for
 * {@link detectAdapter}'s webhook-URL routing. `genericJsonAdapter` is
 * intentionally excluded here — it is the fallback returned by
 * {@link detectAdapter} when nothing else matches.
 *
 * `emailAdapter` is ALSO intentionally excluded: email is selected by env
 * config (`getServerEmailConfig`), not by detecting a webhook URL, so it is
 * dispatched explicitly rather than through this URL-based registry. This
 * keeps `detectAdapter`'s routing for existing http(s) webhook URLs provably
 * unaffected by the email adapter's existence.
 */
export const ADAPTERS: readonly NotificationAdapter[] = [
  telegramAdapter,
  slackAdapter,
  discordAdapter,
  msTeamsAdapter,
  pagerDutyAdapter,
  opsgenieAdapter,
]

/** All adapters, including the generic-json fallback and email. */
export const ALL_ADAPTERS: readonly NotificationAdapter[] = [
  ...ADAPTERS,
  genericJsonAdapter,
  emailAdapter,
]

/**
 * Pick the adapter for a webhook URL. Returns the first channel-specific
 * adapter whose `detect(url)` matches, or the generic JSON adapter otherwise.
 */
export function detectAdapter(url: string): NotificationAdapter {
  for (const adapter of ADAPTERS) {
    if (adapter.detect?.(url)) return adapter
  }
  return genericJsonAdapter
}

/**
 * The concrete body to POST to a single webhook target, chosen by the target
 * URL's adapter. Shared by the server sweep ({@link file://../server-sweep.ts})
 * and the client "Send test" proxy path ({@link file://../alert-dispatcher.ts})
 * so both preview/deliver the same per-channel shape.
 */
export interface WebhookDispatchBody {
  /** Adapter id chosen for this URL (used for the per-channel audit label). */
  adapterId: string
  /**
   * Proxy provider hint. Set to the adapter id when `body` is a
   * provider-specific shape that must be forwarded verbatim (Discord embeds).
   * Undefined for the generic `{ text, content }` wrapper — the client then
   * posts the backward-compatible `{ url, text }` and the proxy builds the
   * wrapper itself.
   */
  provider?: string
  /** The JSON body to POST (the server sweep posts this object directly). */
  body: unknown
}

/**
 * Pick the per-URL webhook body for an alert. Discord targets get rich embeds
 * ({@link buildDiscordBody}); Microsoft Teams targets get an Adaptive Card
 * ({@link buildMSTeamsBody}); Slack incoming webhooks get the caller's rich
 * blocks when provided (the native Slack app, server sweep only) and otherwise
 * the plain `{ text, content }` wrapper; every generic/unknown URL keeps the
 * exact original `{ text, content }` wrapper — zero behavior change. Pure: no
 * transport, so the URL → body-shape mapping is unit-testable per adapter.
 */
export function buildWebhookDispatchBody(params: {
  url: string
  /** Pre-rendered one-line summary (severity/recovery aware). */
  text: string
  payload: AlertPayload
  /** Slack rich blocks — server sweep only, when the Slack app is configured. */
  slackBlocks?: unknown[]
}): WebhookDispatchBody {
  const adapter = detectAdapter(params.url)

  if (adapter.id === 'discord') {
    return {
      adapterId: adapter.id,
      provider: 'discord',
      body: buildDiscordBody(params.payload),
    }
  }

  if (adapter.id === 'msteams') {
    return {
      adapterId: adapter.id,
      provider: 'msteams',
      body: buildMSTeamsBody(params.payload),
    }
  }

  if (adapter.id === 'slack' && params.slackBlocks) {
    return {
      adapterId: adapter.id,
      body: {
        text: params.text,
        content: params.text,
        blocks: params.slackBlocks,
      },
    }
  }

  return {
    adapterId: adapter.id,
    body: { text: params.text, content: params.text },
  }
}
