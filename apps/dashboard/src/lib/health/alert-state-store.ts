/**
 * Alert de-duplication state store + hysteresis state machine.
 *
 * The autonomous health sweep (`server-sweep.ts`) runs every few minutes over
 * every host. Without memory, a persistent unhealthy condition would webhook on
 * *every* run — pure noise. This module remembers the last severity we alerted
 * on per condition so the sweep only notifies when something is genuinely new:
 *
 *   - NEW        — a condition transitions ok → warning/critical
 *   - ESCALATED  — a condition worsens warning → critical
 *   - REMINDER   — a condition persists at the same severity past the cooldown
 *   - RECOVERY   — a previously-firing condition returns to ok
 *
 * Anything else (same severity within the cooldown window, or ok → ok) is
 * suppressed.
 *
 * ## Hysteresis (anti-flap, #2767)
 *
 * A metric hovering right at a threshold flaps ok↔warning every sweep, which
 * without damping would emit a fire + recover pair on every oscillation. Two
 * knobs, configurable per check, absorb that:
 *
 *   - `minConsecutiveBreaches` — a worsening must be observed this many sweeps
 *     in a row before it actually fires (debounces a single blip up).
 *   - `minConsecutiveClears` — a firing condition must read `ok` this many
 *     sweeps in a row before it RECOVERS (bridges single dips below the
 *     threshold, so a flapping metric fires once and recovers once).
 *
 * Both default to `1` in the pure {@link decideNotification} — i.e. no
 * hysteresis, byte-identical to the pre-#2767 transition semantics. The product
 * default (breach=1, clear=2) is applied one layer up, by the sweep's
 * server-side config, so criticals still fire promptly but recovery is damped.
 *
 * The in-flight streak awaiting confirmation lives in the record's
 * `pendingSeverity` / `pendingCount` fields; `firstFiredAt` records when the
 * current incident began firing so a RECOVERY can report its duration.
 *
 * Storage: an in-memory module singleton, mirroring the "memory fallback"
 * pattern the insights subsystem uses (`insights/store/memory-store.ts`) and the
 * table-existence cache. To survive worker restarts (so hysteresis streaks and
 * incident timers are not lost), the sweep hydrates this store from D1 at the
 * start of a tick and flushes it back at the end — see `alert-state-persist.ts`.
 * The pure {@link decideNotification} transition function is decoupled from the
 * backend so it is fully unit-testable.
 *
 * The logical condition key is `host:ruleId`; the last-fired severity lives in
 * the stored record (so the identity a record represents is
 * `host:ruleId:severity`, per the alerting spec). Keeping severity in the record
 * rather than the key is what lets us detect escalation and recovery, which both
 * need to compare the new severity against the previously-fired one.
 */

import type { AlertRuleSeverity } from '@/lib/alerting/rule-registry'

/** Default re-notify cooldown for a persistent condition: 60 minutes. */
export const DEFAULT_ALERT_COOLDOWN_MS = 60 * 60 * 1000

const SEVERITY_ORDER: Record<AlertRuleSeverity, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
}

/** Persisted per-condition state. */
export interface AlertStateRecord {
  /** Last *confirmed* severity we recorded/notified for this condition. */
  severity: AlertRuleSeverity
  /** Epoch ms when the severity last changed. */
  updatedAt: number
  /** Epoch ms of the last notification actually dispatched. */
  notifiedAt: number
  /**
   * Epoch ms when the current incident began firing (ok → firing). Carried
   * through escalation/de-escalation so a RECOVERY can report the incident
   * duration. Absent while the condition is ok.
   */
  firstFiredAt?: number
  /**
   * Severity awaiting hysteresis confirmation — differs from {@link severity}.
   * `undefined` when there is no in-flight streak (steady state).
   */
  pendingSeverity?: AlertRuleSeverity
  /** Consecutive sweeps observed at {@link pendingSeverity}. */
  pendingCount?: number
}

/** What kind of transition the current evaluation represents. */
export type AlertDecisionKind =
  | 'new'
  | 'escalated'
  | 'reminder'
  | 'recovery'
  | 'suppressed'

export interface AlertDecision {
  /** Whether the sweep should dispatch a notification. */
  notify: boolean
  kind: AlertDecisionKind
  /** Current severity being evaluated. */
  severity: AlertRuleSeverity
  /** Severity previously on record (defaults to 'ok' when unseen). */
  previousSeverity: AlertRuleSeverity
  /**
   * For a RECOVERY, how long the incident was firing, in ms — `now` minus the
   * incident's `firstFiredAt`. Absent when the fire time is unknown (e.g. a
   * condition already firing before this store had a record for it).
   */
  incidentDurationMs?: number
}

/** Minimal persistence contract; swap in a DB-backed store later if needed. */
export interface AlertStateStore {
  get(key: string): AlertStateRecord | undefined
  set(key: string, record: AlertStateRecord): void
  delete(key: string): void
  clear(): void
  /** Read-only enumeration of all current condition keys and records. */
  entries(): IterableIterator<[string, AlertStateRecord]>
}

/** Stable per-condition key. Severity is tracked in the record, not the key. */
export function alertStateKey(hostId: number, ruleId: string): string {
  return `${hostId}:${ruleId}`
}

/**
 * In-memory alert-state backend. Ephemeral by design; lost on worker restart.
 */
export class MemoryAlertStateStore implements AlertStateStore {
  private readonly records = new Map<string, AlertStateRecord>()

  get(key: string): AlertStateRecord | undefined {
    return this.records.get(key)
  }

  set(key: string, record: AlertStateRecord): void {
    this.records.set(key, record)
  }

  delete(key: string): void {
    this.records.delete(key)
  }

  clear(): void {
    this.records.clear()
  }

  entries(): IterableIterator<[string, AlertStateRecord]> {
    return this.records.entries()
  }
}

/** Process-wide singleton used by the sweep. */
export const alertStateStore: AlertStateStore = new MemoryAlertStateStore()

export interface DecideOptions {
  /** Re-notify window for a persistent same-severity condition, in ms. */
  cooldownMs?: number
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number
  /**
   * Consecutive worsening observations required before a NEW/ESCALATED alert
   * fires (anti-flap, #2767). `1` (default) = fire on first breach — no
   * hysteresis. Values below 1 are clamped to 1.
   */
  minConsecutiveBreaches?: number
  /**
   * Consecutive `ok` observations required before a firing condition RECOVERS
   * (anti-flap, #2767). `1` (default) = recover on first clear — no hysteresis.
   * Values below 1 are clamped to 1.
   */
  minConsecutiveClears?: number
}

/**
 * Pure state transition: given the previous record and the current severity,
 * decide whether to notify and compute the next record to persist.
 *
 * `next` is the record to store, or `null` when the condition is ok and no
 * record should be kept (recovery clears it, ok→ok keeps nothing).
 *
 * Hysteresis: a worsening is held (suppressed, streak tracked in the returned
 * record's `pendingSeverity`/`pendingCount`) until observed
 * `minConsecutiveBreaches` sweeps in a row; a clear is held until observed
 * `minConsecutiveClears` sweeps in a row. A single opposing observation resets
 * the streak, so a metric that flaps around a threshold fires once and recovers
 * once instead of on every oscillation.
 */
export function decideNotification(
  prev: AlertStateRecord | undefined,
  current: AlertRuleSeverity,
  opts: DecideOptions = {}
): { decision: AlertDecision; next: AlertStateRecord | null } {
  const now = opts.now ?? Date.now()
  const cooldownMs = opts.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS
  const minBreaches = Math.max(1, Math.floor(opts.minConsecutiveBreaches ?? 1))
  const minClears = Math.max(1, Math.floor(opts.minConsecutiveClears ?? 1))
  const confirmed: AlertRuleSeverity = prev?.severity ?? 'ok'
  const firstFiredAt = prev?.firstFiredAt
  const rankCurrent = SEVERITY_ORDER[current]
  const rankConfirmed = SEVERITY_ORDER[confirmed]

  // Consecutive streak for `target`, extending prev's pending streak when it
  // was already tracking the same target, otherwise starting fresh at 1.
  const streakFor = (target: AlertRuleSeverity): number =>
    prev?.pendingSeverity === target ? (prev.pendingCount ?? 0) + 1 : 1

  const withFired = (rec: AlertStateRecord): AlertStateRecord =>
    firstFiredAt !== undefined ? { ...rec, firstFiredAt } : rec

  // A "hold" keeps the confirmed state exactly as-is (so the cooldown clock and
  // incident timer are untouched) while recording the in-flight pending streak.
  const hold = (
    pendingSeverity: AlertRuleSeverity,
    pendingCount: number
  ): { decision: AlertDecision; next: AlertStateRecord } => ({
    decision: {
      notify: false,
      kind: 'suppressed',
      severity: current,
      previousSeverity: confirmed,
    },
    next: withFired({
      severity: confirmed,
      updatedAt: prev?.updatedAt ?? now,
      notifiedAt: prev?.notifiedAt ?? (confirmed === 'ok' ? 0 : now),
      pendingSeverity,
      pendingCount,
    }),
  })

  // (A) Steady at the confirmed severity — any pending streak is cleared.
  if (current === confirmed) {
    if (current === 'ok') {
      // ok → ok: nothing to remember, nothing to send.
      return {
        decision: {
          notify: false,
          kind: 'suppressed',
          severity: 'ok',
          previousSeverity: 'ok',
        },
        next: null,
      }
    }
    // Firing steady: re-notify only once the cooldown has elapsed.
    const elapsed = now - (prev?.notifiedAt ?? 0)
    if (cooldownMs > 0 && elapsed >= cooldownMs) {
      return {
        decision: {
          notify: true,
          kind: 'reminder',
          severity: current,
          previousSeverity: confirmed,
        },
        next: withFired({
          severity: current,
          updatedAt: prev?.updatedAt ?? now,
          notifiedAt: now,
        }),
      }
    }
    return {
      decision: {
        notify: false,
        kind: 'suppressed',
        severity: current,
        previousSeverity: confirmed,
      },
      next: withFired({
        severity: current,
        updatedAt: prev?.updatedAt ?? now,
        notifiedAt: prev?.notifiedAt ?? now,
      }),
    }
  }

  // (B) Worsening (ok → firing, or warning → critical) — gated by hysteresis.
  if (rankCurrent > rankConfirmed) {
    const count = streakFor(current)
    if (count < minBreaches) return hold(current, count)
    // Confirmed: NEW or ESCALATED — always notify regardless of cooldown.
    const started = confirmed === 'ok' ? now : (firstFiredAt ?? now)
    return {
      decision: {
        notify: true,
        kind: confirmed === 'ok' ? 'new' : 'escalated',
        severity: current,
        previousSeverity: confirmed,
      },
      next: {
        severity: current,
        updatedAt: now,
        notifiedAt: now,
        firstFiredAt: started,
      },
    }
  }

  // (C) Improving toward ok — RECOVERY, gated by clear hysteresis.
  if (current === 'ok') {
    const count = streakFor('ok')
    if (count < minClears) return hold('ok', count)
    const decision: AlertDecision = {
      notify: true,
      kind: 'recovery',
      severity: 'ok',
      previousSeverity: confirmed,
    }
    if (firstFiredAt !== undefined) {
      decision.incidentDurationMs = Math.max(0, now - firstFiredAt)
    }
    return { decision, next: null }
  }

  // (C2) De-escalation but still firing (critical → warning): not a new alert.
  // Lower the recorded severity immediately (a later re-escalation is still
  // detected) but keep the notify timestamp so the cooldown isn't reset, and
  // carry the incident timer since it's the same incident.
  return {
    decision: {
      notify: false,
      kind: 'suppressed',
      severity: current,
      previousSeverity: confirmed,
    },
    next: withFired({
      severity: current,
      updatedAt: now,
      notifiedAt: prev?.notifiedAt ?? now,
    }),
  }
}

/**
 * Read → decide against a store, returning the decision plus a deferred
 * `commit` thunk. The store is **not** written until the caller invokes
 * `commit()` — for the sweep, that means only after a confirmed webhook
 * delivery, so a failed send doesn't get remembered as "notified" and is
 * retried on the next sweep instead of suppressed by the cooldown.
 */
export function evaluateAlert(
  store: AlertStateStore,
  params: {
    hostId: number
    ruleId: string
    severity: AlertRuleSeverity
    cooldownMs?: number
    now?: number
    minConsecutiveBreaches?: number
    minConsecutiveClears?: number
  }
): { decision: AlertDecision; commit: () => void } {
  const key = alertStateKey(params.hostId, params.ruleId)
  const prev = store.get(key)
  const { decision, next } = decideNotification(prev, params.severity, {
    cooldownMs: params.cooldownMs,
    now: params.now,
    minConsecutiveBreaches: params.minConsecutiveBreaches,
    minConsecutiveClears: params.minConsecutiveClears,
  })
  const commit = () => {
    if (next === null) {
      store.delete(key)
    } else {
      store.set(key, next)
    }
  }
  return { decision, commit }
}
