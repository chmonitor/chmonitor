/**
 * Event taxonomy for the outbound webhook bus (plan 44).
 *
 * `EMITTABLE_EVENT_TYPES` is the single source of truth for which event types
 * a subscription can filter on — both the CRUD route (validates `event_types`
 * on create/update) and the UI (multi-select options) read from this union so
 * neither can offer a type nothing actually emits.
 *
 * Deliberately narrower than the plan's aspirational list
 * (`alert.fired` / `alert.resolved` / `finding.created` / `insight.created`
 * were sketched as future producers). Those run against env-configured hosts
 * with NO per-user owner anywhere in this codebase today — the health-alert
 * cron sweep (`lib/health/server-alert-config.ts`) reads only `process.env`,
 * and the insights cron (`routes/api/cron/*`, `lib/insights/generate-insights.ts`)
 * has no session either. `emitEvent` looks up subscriptions by `userId`
 * (subscriptions are strictly user-scoped, see `subscription-store.ts`), so
 * there is no owner to attribute those events to without inventing a mapping
 * this plan doesn't ask for. Only `user-connections` (create/delete) has a
 * genuine per-request Clerk user id (`resolveConnectionUserId()`) — so only
 * connection events are wired. Extend this union ONLY when a producer has a
 * real userId to pass to `emitEvent`.
 */
export const EMITTABLE_EVENT_TYPES = [
  'connection.created',
  'connection.deleted',
] as const

export type EmittableEventType = (typeof EMITTABLE_EVENT_TYPES)[number]

/**
 * Internal-only synthetic event used by the subscription "Send test" action.
 * Delivered directly to ONE subscription (bypassing its configured
 * `event_types` filter) so a user can verify their receiver without waiting
 * for a real event. Never persisted as a value inside `event_types` and never
 * offered as a subscribable option in the UI.
 */
export const PING_EVENT_TYPE = 'webhook.ping' as const

export type WebhookEventType = EmittableEventType | typeof PING_EVENT_TYPE

/** Envelope delivered (as JSON) to every subscriber. */
export interface EventPayload<T = unknown> {
  /** Stable id for this occurrence — also sent as `X-Chmonitor-Delivery`. */
  id: string
  type: WebhookEventType
  /** ISO-8601 timestamp of when the event occurred. */
  occurred_at: string
  host_id?: number
  data: T
}

export function isEmittableEventType(
  value: string
): value is EmittableEventType {
  return (EMITTABLE_EVENT_TYPES as readonly string[]).includes(value)
}

/** Validates a caller-supplied `event_types` array for subscription create/update. */
export function parseEventTypes(value: unknown): EmittableEventType[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !isEmittableEventType(entry)) return null
    seen.add(entry)
  }
  return Array.from(seen) as EmittableEventType[]
}
