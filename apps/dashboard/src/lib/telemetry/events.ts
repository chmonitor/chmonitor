// Telemetry event schema — a closed, typed set of event names plus a flat,
// non-identifying props bag.
//
// Privacy contract: props carry only counts, enums, booleans, and durations.
// No PII, query text, hostnames, IPs, or connection strings. redact.ts enforces
// this defensively before any event is emitted.
//
// Naming note for prop keys: avoid the tokens the redactor blocks (`host`, `ip`,
// `url`, `query`, `sql`, `email`, `token`, …). Name count dimensions plainly —
// e.g. `num_hosts`, `view_count`, `ch_flavor` — not `host_count`/`query_count`.
// Send a ClickHouse version as `major.minor` (e.g. `24.8`); a full four-part
// version (`24.8.1.2`) collides with the IPv4 redaction pattern.

export const TELEMETRY_EVENTS = [
  'app_loaded',
  'cluster_connected',
  'feature_viewed',
  'health_viewed',
  'queries_viewed',
  'ai_query_sent',
] as const

export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number]

export type TelemetryPropValue = string | number | boolean | undefined
export type TelemetryProps = Record<string, TelemetryPropValue>

export interface TelemetryPayload {
  readonly event: TelemetryEvent
  readonly props: TelemetryProps
}

export function isTelemetryEvent(value: string): value is TelemetryEvent {
  return (TELEMETRY_EVENTS as readonly string[]).includes(value)
}
