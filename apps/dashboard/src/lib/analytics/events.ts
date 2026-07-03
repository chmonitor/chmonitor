// Product analytics event schema — a closed, typed set of funnel event names
// plus a flat, non-identifying props bag.
//
// This is a DIFFERENT system from lib/telemetry/ (anonymous, on-by-default OSS
// instance telemetry sent to chmonitor's own collector) and from self-tracking
// (writes usage events to the operator's own ClickHouse instance). Product
// analytics tracks the SaaS conversion funnel (landing → signup → activation →
// upgrade) via PostHog, and is OFF by default — a hard no-op unless an
// analytics key is configured. See docs/operate/advanced/product-analytics.mdx.
//
// Privacy contract: props carry only counts, enums, and booleans — no PII,
// query text, hostnames, IPs, connection strings, or emails. redactProps
// (reused from lib/telemetry/redact) enforces this defensively before any
// event leaves the process.

export const ANALYTICS_EVENTS = [
  'signup',
  'cluster_connect',
  'first_chart_render',
  'agent_message',
  'upgrade_click',
  'checkout_started',
  'sample_cluster_connected',
  'sample_to_real_converted',
] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]

export type AnalyticsPropValue = string | number | boolean | undefined
export type AnalyticsProps = Record<string, AnalyticsPropValue>

export function isAnalyticsEvent(value: string): value is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(value)
}
