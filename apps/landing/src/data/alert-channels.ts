/**
 * Shipped health-alert channels. Source of truth matches
 * docs/content/guide/features/health.mdx — native adapters, not one webhook.
 *
 * Homepage, /features/alerting, and the comparison table must use these
 * strings so the three surfaces cannot contradict each other.
 */
export const ALERT_CHANNELS = [
  'Slack',
  'Discord',
  'Teams',
  'Google Chat',
  'Telegram',
  'ntfy',
  'Pushover',
  'Twilio SMS',
  'Opsgenie',
  'PagerDuty',
  'healthchecks.io',
] as const

export type AlertChannel = (typeof ALERT_CHANNELS)[number]

/** Short phrase for tight surfaces (hero, coverage grid, comparison, cards). */
export const ALERT_CHANNELS_SHORT =
  'Slack, Discord, PagerDuty, Opsgenie, and more'

/** Full shipped list for the dedicated alerting page. */
export const ALERT_CHANNELS_FULL = `${ALERT_CHANNELS.slice(0, -1).join(', ')}, and ${ALERT_CHANNELS[ALERT_CHANNELS.length - 1]}`
