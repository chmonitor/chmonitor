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

import type { NotificationAdapter } from './types'

import { discordAdapter } from './discord'
import { emailAdapter } from './email'
import { genericJsonAdapter } from './generic-json'
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
