/**
 * Pure suppression predicates for the health sweep (#2884).
 *
 * Every gate the sweep applies between "a rule classified a finding" and "we
 * actually deliver it" lives here as a side-effect-free function, so the
 * alerting semantics can be unit-tested without D1, network, or the rule
 * registry. These compose the existing domain helpers (`maintenance-windows`,
 * `quiet-hours`, `alert-ack-store`) rather than re-implementing them — the
 * value added is a single, named, testable decision per gate.
 *
 * NOTE on cooldown: "within cooldown" is not a predicate here — it is already
 * owned by `evaluateAlert` in `alert-state-store.ts`, which returns a
 * non-notify decision for a condition that is still inside its cooldown. The
 * sweep's cooldown behaviour is therefore expressed as `decision.notify`.
 */

import type { AlertRuleSeverity } from '@/lib/alerting/rule-registry'
import type { AlertAck } from './../alert-ack-store'
import type { MaintenanceWindow } from './../maintenance-windows'
import type { QuietHours } from './../quiet-hours'

import { isAcked } from './../alert-ack-store'
import { isSuppressed } from './../maintenance-windows'
import { isQuietSuppressed } from './../quiet-hours'

export type Severity = AlertRuleSeverity

export const SEVERITY_ORDER: Record<Severity, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
}

/**
 * Whether a classified severity clears the global minimum-severity gate
 * (`HEALTH_ALERT_MIN_SEVERITY`).
 */
export function meetsMinSeverity(
  severity: Severity,
  minSeverity: 'warning' | 'critical'
): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[minSeverity]
}

/**
 * The severity the dedup state store tracks for a finding: sub-threshold
 * severities collapse to `'ok'` so the store only knows about conditions the
 * operator asked to hear about (and a drop below the threshold reads as a
 * recovery).
 */
export function effectiveSeverity(
  severity: Severity,
  minSeverity: 'warning' | 'critical'
): Severity {
  return meetsMinSeverity(severity, minSeverity) ? severity : 'ok'
}

/**
 * A maintenance window covering this host right now silences EVERY channel.
 * Only applies to a notifying decision — a deduped/non-notify decision has
 * nothing to suppress.
 */
export function isMaintenanceGated(params: {
  notify: boolean
  windows: MaintenanceWindow[]
  hostId: number
  now: number
}): boolean {
  return (
    params.notify && isSuppressed(params.windows, params.hostId, params.now)
  )
}

/**
 * A quiet-hours window silences delivery for this severity right now.
 * Recoveries are never quiet-gated (a resolved condition always reaches the
 * operator), and an `'ok'` effective severity has nothing to silence.
 */
export function isQuietHoursGated(params: {
  notify: boolean
  isRecovery: boolean
  effective: Severity
  quietHours: QuietHours[]
  now: number
}): boolean {
  const { notify, isRecovery, effective } = params
  return (
    notify &&
    !isRecovery &&
    (effective === 'warning' || effective === 'critical') &&
    isQuietSuppressed(params.quietHours, effective, params.now)
  )
}

/**
 * An active operator ACK silences a notifying non-recovery alert (plan 29).
 * A recovery is never ack-gated — it clears the ACK instead.
 */
export function isAckGated(params: {
  notify: boolean
  isRecovery: boolean
  acks: AlertAck[]
  hostId: number
  ruleId: string
  now: number
}): boolean {
  return (
    params.notify &&
    !params.isRecovery &&
    isAcked(params.acks, params.hostId, params.ruleId, params.now)
  )
}
