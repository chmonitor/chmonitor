/**
 * Event taxonomy for the outbound webhook bus (plan 44).
 *
 * `EMITTABLE_EVENT_TYPES` is the single source of truth for which event types
 * a subscription can filter on — both the CRUD route (validates `event_types`
 * on create/update) and the UI (multi-select options) read from this union so
 * neither can offer a type nothing actually emits.
 *
 * `connection.created` / `connection.deleted` are strictly **user-scoped**:
 * `emitEvent` looks up subscriptions by `userId` (the genuine per-request
 * Clerk user id from `resolveConnectionUserId()`), so only the creating
 * user's own subscriptions ever receive them.
 *
 * `alert.fired` / `alert.resolved` (#2664) are different: they come from the
 * health-alert cron sweep (`lib/health/server-sweep.ts`), which runs over
 * env-configured hosts (`getClickHouseConfigs()`) — the OPERATOR's hosts, not
 * any signed-in user's. There is no per-request Clerk user id to attribute
 * them to. Instead of inventing a fake owner, these two types are
 * **instance-scoped**: only a subscription created with `scope: 'instance'`
 * (see `SubscriptionScope` / `INSTANCE_SCOPED_EVENT_TYPES` in
 * `subscription-store.ts`) can subscribe to them, and delivery fans out to
 * every enabled instance-scoped subscription across ALL users via
 * `emitInstanceEvent` (`outbound-bus.ts`) — not the per-user `emitEvent`.
 * Per-user D1 connections (when the alert engine grows per-user alerting)
 * would keep the ordinary user-scoped path; this instance scope exists
 * specifically because env hosts belong to the operator, not a Clerk user.
 */
export const EMITTABLE_EVENT_TYPES = [
  'connection.created',
  'connection.deleted',
  'alert.fired',
  'alert.resolved',
] as const

export type EmittableEventType = (typeof EMITTABLE_EVENT_TYPES)[number]

/**
 * Subset of {@link EMITTABLE_EVENT_TYPES} that has no per-user owner and is
 * only ever delivered to instance-scoped subscriptions — see the docblock
 * above. Used by the subscriptions API to reject e.g. a `scope: 'user'`
 * subscription requesting `alert.fired` (it would create successfully but
 * could never receive a delivery, which is worse than a clear 400).
 */
export const INSTANCE_SCOPED_EVENT_TYPES = [
  'alert.fired',
  'alert.resolved',
] as const satisfies readonly EmittableEventType[]

export function isInstanceScopedEventType(value: EmittableEventType): boolean {
  return (INSTANCE_SCOPED_EVENT_TYPES as readonly string[]).includes(value)
}

export interface AlertEventData {
  ruleId: string
  title: string
  severity: 'warning' | 'critical'
  hostId: number
  hostLabel: string
  value: number | null
  label: string
  resolved: boolean
  occurredAt: string
}

/**
 * Internal-only synthetic event used by the subscription "Send test" action.
 * Delivered directly to ONE subscription (bypassing its configured
 * `event_types` filter) so a user can verify their receiver without waiting
 * for a real event. Never persisted as a value inside `event_types` and never
 * offered as a subscribable option in the UI.
 */
export const PING_EVENT_TYPE = 'webhook.ping' as const

export type WebhookEventType = EmittableEventType | typeof PING_EVENT_TYPE

export interface EventPayload<T = unknown> {
  id: string
  type: WebhookEventType
  occurred_at: string
  host_id?: number
  data: T
}

export function isEmittableEventType(
  value: string
): value is EmittableEventType {
  return (EMITTABLE_EVENT_TYPES as readonly string[]).includes(value)
}

export function parseEventTypes(value: unknown): EmittableEventType[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || !isEmittableEventType(entry)) return null
    seen.add(entry)
  }
  return Array.from(seen) as EmittableEventType[]
}
