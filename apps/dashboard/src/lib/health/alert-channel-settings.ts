/**
 * Per-channel alert settings + the ONE shared resolver both dispatch paths use
 * (#2661).
 *
 * `minSeverity` used to be a single global gate — you could not say "page me
 * only on critical, but Slack everything". This module adds an optional
 * per-channel override (`enabled` + `minSeverity`) for every delivery channel
 * that exists across the two dispatch paths, plus {@link resolveChannelDelivery}
 * — the single pure decision function called by BOTH the client dispatcher
 * (`alert-dispatcher.ts`) and the server sweep (`server-sweep.ts`), so a
 * gate-matrix test over this one function covers both.
 *
 * Everything here is PURE — no `window`, no `process.env`, no I/O — so it is
 * safe to import from either runtime and trivially unit-testable.
 */

/** Two-severity gate vocabulary shared with `AlertSettings.minSeverity`. */
export type AlertSeverityFloor = 'warning' | 'critical'

/**
 * Every delivery channel that has a dispatch path today. `browser` /
 * `healthchecks` are client-only (`alert-dispatcher.ts`); `opsgenie` / `email` /
 * `pagerduty` / `telegram` / `ntfy` / `pushover` are server-only
 * (`server-sweep.ts`); `webhook` exists in both. `twilio` keeps its own
 * dedicated severity floor (`HEALTH_ALERT_TWILIO_MIN_SEVERITY`, #2668) and is
 * intentionally NOT part of this generic map — see `server-alert-config.ts`.
 */
export type AlertChannelId =
  | 'browser'
  | 'webhook'
  | 'healthchecks'
  | 'email'
  | 'opsgenie'
  | 'pagerduty'
  | 'telegram'
  | 'ntfy'
  | 'pushover'

/** Ordered channel id list — the UI iterates this, parsing validates against it. */
export const ALERT_CHANNEL_IDS: readonly AlertChannelId[] = [
  'browser',
  'webhook',
  'healthchecks',
  'email',
  'opsgenie',
  'pagerduty',
  'telegram',
  'ntfy',
  'pushover',
]

/**
 * Per-channel override. Both fields are optional and default to "inherit":
 * an absent `minSeverity` falls back to the global gate, and an absent
 * `enabled` is treated as `true`.
 */
export interface ChannelAlertOverride {
  /** When `false`, the channel never fires regardless of severity. */
  enabled?: boolean
  /** Channel-specific floor; beats the global gate, loses to a route floor. */
  minSeverity?: AlertSeverityFloor
}

/** Per-channel overrides keyed by channel id (absent key = inherit global). */
export type ChannelSettingsMap = Partial<
  Record<AlertChannelId, ChannelAlertOverride>
>

const SEVERITY_RANK: Record<AlertSeverityFloor, number> = {
  warning: 1,
  critical: 2,
}

/** True when `severity` is at or above `threshold` (warning < critical). */
export function severityMeetsThreshold(
  severity: AlertSeverityFloor,
  threshold: AlertSeverityFloor
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold]
}

/**
 * The single per-channel gate, shared by both dispatch paths.
 *
 * Precedence (issue #2661): a disabled channel NEVER fires; otherwise the
 * effective floor is the first present of
 *   route-level `minSeverity` › channel-level `minSeverity` › global `minSeverity`
 * and the finding fires only when its severity is at or above that floor.
 *
 * `routeMinSeverity` is server-only (per-rule/per-host routes live in D1); the
 * client passes `channel` overrides from localStorage. Passing neither reduces
 * this to the historical single global gate.
 */
export function resolveChannelDelivery(params: {
  severity: AlertSeverityFloor
  globalMinSeverity: AlertSeverityFloor
  channel?: ChannelAlertOverride
  routeMinSeverity?: AlertSeverityFloor | null
}): boolean {
  if (params.channel?.enabled === false) return false
  const threshold =
    params.routeMinSeverity ??
    params.channel?.minSeverity ??
    params.globalMinSeverity
  return severityMeetsThreshold(params.severity, threshold)
}

function isSeverityFloor(value: unknown): value is AlertSeverityFloor {
  return value === 'warning' || value === 'critical'
}

/**
 * Sanitize an untrusted value (parsed localStorage / env) into a
 * {@link ChannelSettingsMap}. Unknown channel ids and malformed fields are
 * dropped; an override with neither a valid `enabled` nor `minSeverity` is
 * omitted entirely (nothing to persist). Returns `undefined` when there is
 * nothing usable, so callers can leave the key absent (= inherit).
 */
export function parseChannelSettings(
  raw: unknown
): ChannelSettingsMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const source = raw as Record<string, unknown>
  const out: ChannelSettingsMap = {}
  for (const id of ALERT_CHANNEL_IDS) {
    const entry = source[id]
    if (!entry || typeof entry !== 'object') continue
    const { enabled, minSeverity } = entry as Record<string, unknown>
    const override: ChannelAlertOverride = {}
    if (typeof enabled === 'boolean') override.enabled = enabled
    if (isSeverityFloor(minSeverity)) override.minSeverity = minSeverity
    if (override.enabled !== undefined || override.minSeverity !== undefined) {
      out[id] = override
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}
