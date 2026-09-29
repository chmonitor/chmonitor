/**
 * The outbound alert channels `alert_channel_config` can hold (#2665). A leaf
 * module so the declarative schema (`declarative/schema.ts`) can validate a
 * `channel` without importing the store, which reads the declarative layer.
 */

/**
 * Every outbound delivery channel that can be persisted here. Superset of
 * `AlertChannelId`'s server-reachable members plus `twilio` (which keeps its
 * own severity floor and is excluded from the generic `ChannelSettingsMap`).
 * `browser` / `pagerduty` are intentionally absent: browser notifications are
 * per-browser (localStorage), and PagerDuty is configured per-route in
 * `alert_routes`, not as a single global destination.
 */
export type AlertConfigChannel =
  | 'webhook'
  | 'healthchecks'
  | 'email'
  | 'opsgenie'
  | 'telegram'
  | 'ntfy'
  | 'pushover'
  | 'twilio'

/** Ordered channel list — the UI iterates this, parsing validates against it. */
export const ALERT_CONFIG_CHANNELS: readonly AlertConfigChannel[] = [
  'webhook',
  'healthchecks',
  'email',
  'opsgenie',
  'telegram',
  'ntfy',
  'pushover',
  'twilio',
]

export function isAlertConfigChannel(v: unknown): v is AlertConfigChannel {
  return (
    typeof v === 'string' &&
    (ALERT_CONFIG_CHANNELS as readonly string[]).includes(v)
  )
}
