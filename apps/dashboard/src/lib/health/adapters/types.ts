/**
 * Notification adapter layer — normalized alert payload + adapter contract.
 *
 * These types describe a channel-agnostic view of a health/alert event. Each
 * concrete adapter (Telegram, Slack, Discord, PagerDuty, generic JSON) turns an
 * {@link AlertPayload} into the request body that channel expects.
 *
 * Everything in this layer is PURE — no network, no side effects — so the
 * formatters are trivially unit-testable and safe to run anywhere. Wiring these
 * bodies to an actual transport (fetch, tokens, URLs) is the job of a later
 * dispatch slice, not this module.
 *
 * The severity vocabulary mirrors the health subsystem (`'warning' | 'critical'`
 * from `HealthAlertEvent` / `SweepFinding`) and adds `'recovery'` so an adapter
 * can render a resolved incident (🟢) — the "ok" transition the sweep detects.
 */

/** Alert severity. `recovery` = a previously firing incident returned to ok. */
export type AlertSeverity = 'warning' | 'critical' | 'recovery'

/**
 * Channel-agnostic alert payload.
 *
 * Field names intentionally track the health subsystem's existing shapes
 * (`HealthAlertEvent`, `SweepFinding`) so callers can map without translation.
 */
export interface AlertPayload {
  /** Alert severity, drives colour/emoji/mapping in every adapter. */
  severity: AlertSeverity
  /** Human-readable host label (e.g. custom name or hostname). */
  hostLabel: string
  /** Numeric host id used for dedup keys and routing. */
  hostId: number
  /** Stable metric / check identifier (e.g. `failed-mutations`). */
  metric: string
  /** Observed numeric value, or null when unavailable. */
  value: number | null
  /** Warning threshold that classified this value, when known. */
  warnThreshold?: number | null
  /** Critical threshold that classified this value, when known. */
  critThreshold?: number | null
  /** Short human title for the alert (e.g. the check title). */
  title: string
  /** Human-readable label describing the value (e.g. "3 stuck merges"). */
  label: string
  /** Runbook / documentation URLs relevant to this alert. */
  runbookUrls?: readonly string[]
  /**
   * Labeled remediation actions from the firing rule's `remediationActions`
   * (plans/33-remediation-action-links.md). Channel-agnostic and intentionally
   * carries only ids — NEVER the underlying SQL — so a channel-specific
   * adapter (e.g. Slack) can render a button whose `value` is just
   * `{hostId, ruleId, actionId}`; the SQL for `diagnostic` actions is always
   * re-resolved server-side by `POST /api/v1/health/actions`, never taken from
   * client input.
   */
  actions?: readonly {
    id: string
    label: string
    kind: 'runbook' | 'diagnostic'
    /** Present only for `kind === 'runbook'`. */
    url?: string
  }[]
  /** ISO-8601 timestamp of when the alert was observed. */
  timestamp: string
  /**
   * Optional raw snapshot forwarded to channels that can carry structured
   * context (e.g. generic JSON, PagerDuty custom_details). Loosely typed for now.
   */
  snapshot?: unknown
}

/**
 * A notification adapter turns a normalized payload into a channel-specific
 * request body. `buildBody` is pure; transport/config (tokens, URLs) is applied
 * by the caller. `detect` lets a registry pick an adapter from a webhook URL.
 */
export interface NotificationAdapter {
  /** Stable adapter identifier (e.g. `telegram`, `slack`). */
  id: string
  /** Return true if the given webhook URL belongs to this channel. */
  detect?(url: string): boolean
  /** Build the channel-specific request body from a normalized payload. */
  buildBody(payload: AlertPayload): unknown
}
