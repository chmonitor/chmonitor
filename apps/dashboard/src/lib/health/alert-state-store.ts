/**
 * Alert de-duplication state store.
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
 * Storage: an in-memory module singleton, mirroring the "memory fallback"
 * pattern the insights subsystem uses (`insights/store/memory-store.ts`) and the
 * table-existence cache. Alert dedup state is intentionally ephemeral — after a
 * cold start the worst case is a single duplicate alert per active condition,
 * which is acceptable. The pure {@link decideNotification} transition function
 * is decoupled from the backend so it is fully unit-testable.
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
  /** Last severity we recorded/notified for this condition. */
  severity: AlertRuleSeverity
  /** Epoch ms when the severity last changed. */
  updatedAt: number
  /** Epoch ms of the last notification actually dispatched. */
  notifiedAt: number
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
}

/**
 * Pure state transition: given the previous record and the current severity,
 * decide whether to notify and compute the next record to persist.
 *
 * `next` is the record to store, or `null` when the condition is ok and no
 * record should be kept (recovery clears it, ok→ok keeps nothing).
 */
export function decideNotification(
  prev: AlertStateRecord | undefined,
  current: AlertRuleSeverity,
  opts: DecideOptions = {}
): { decision: AlertDecision; next: AlertStateRecord | null } {
  const now = opts.now ?? Date.now()
  const cooldownMs = opts.cooldownMs ?? DEFAULT_ALERT_COOLDOWN_MS
  const previousSeverity: AlertRuleSeverity = prev?.severity ?? 'ok'

  // Condition is healthy now.
  if (current === 'ok') {
    if (previousSeverity !== 'ok') {
      // A previously-firing condition recovered → emit RECOVERY, clear state.
      return {
        decision: {
          notify: true,
          kind: 'recovery',
          severity: 'ok',
          previousSeverity,
        },
        next: null,
      }
    }
    // ok → ok: nothing to remember, nothing to send.
    return {
      decision: {
        notify: false,
        kind: 'suppressed',
        severity: 'ok',
        previousSeverity,
      },
      next: null,
    }
  }

  // Condition is firing (warning | critical).
  const rankCurrent = SEVERITY_ORDER[current]
  const rankPrev = SEVERITY_ORDER[previousSeverity]

  // NEW (ok → firing) or ESCALATED (warning → critical): always notify,
  // regardless of cooldown — a worsening condition is important.
  if (rankCurrent > rankPrev) {
    return {
      decision: {
        notify: true,
        kind: previousSeverity === 'ok' ? 'new' : 'escalated',
        severity: current,
        previousSeverity,
      },
      next: { severity: current, updatedAt: now, notifiedAt: now },
    }
  }

  // Same severity persisting: re-notify only once the cooldown has elapsed.
  if (rankCurrent === rankPrev) {
    const elapsed = now - (prev?.notifiedAt ?? 0)
    if (cooldownMs > 0 && elapsed >= cooldownMs) {
      return {
        decision: {
          notify: true,
          kind: 'reminder',
          severity: current,
          previousSeverity,
        },
        next: {
          severity: current,
          updatedAt: prev?.updatedAt ?? now,
          notifiedAt: now,
        },
      }
    }
    // Still within cooldown → suppress, but keep the existing timestamps.
    return {
      decision: {
        notify: false,
        kind: 'suppressed',
        severity: current,
        previousSeverity,
      },
      next: {
        severity: current,
        updatedAt: prev?.updatedAt ?? now,
        notifiedAt: prev?.notifiedAt ?? now,
      },
    }
  }

  // De-escalation but still firing (critical → warning): not a new alert.
  // Lower the recorded severity so a later re-escalation is detected, but keep
  // the last notify timestamp so we don't reset the cooldown.
  return {
    decision: {
      notify: false,
      kind: 'suppressed',
      severity: current,
      previousSeverity,
    },
    next: {
      severity: current,
      updatedAt: now,
      notifiedAt: prev?.notifiedAt ?? now,
    },
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
  }
): { decision: AlertDecision; commit: () => void } {
  const key = alertStateKey(params.hostId, params.ruleId)
  const prev = store.get(key)
  const { decision, next } = decideNotification(prev, params.severity, {
    cooldownMs: params.cooldownMs,
    now: params.now,
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
