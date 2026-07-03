/**
 * State-transition tests for the alert de-dup store. No mocks — exercises the
 * pure decision function and the read/decide/persist wrapper against the memory
 * backend, covering: new, escalated, cooldown-suppressed, reminder (post
 * cooldown), and recovery.
 */

import type { AlertStateRecord } from './alert-state-store'

import {
  alertStateKey,
  DEFAULT_ALERT_COOLDOWN_MS,
  decideNotification,
  evaluateAlert,
  MemoryAlertStateStore,
} from './alert-state-store'
import { describe, expect, test } from 'bun:test'

const rec = (over: Partial<AlertStateRecord> = {}): AlertStateRecord => ({
  severity: 'warning',
  updatedAt: 1_000,
  notifiedAt: 1_000,
  ...over,
})

describe('decideNotification', () => {
  test('NEW: ok → warning notifies and records severity', () => {
    const { decision, next } = decideNotification(undefined, 'warning', {
      now: 5_000,
    })
    expect(decision.notify).toBe(true)
    expect(decision.kind).toBe('new')
    expect(decision.previousSeverity).toBe('ok')
    expect(next).toEqual({
      severity: 'warning',
      updatedAt: 5_000,
      notifiedAt: 5_000,
    })
  })

  test('NEW: ok → critical notifies', () => {
    const { decision } = decideNotification(undefined, 'critical')
    expect(decision.notify).toBe(true)
    expect(decision.kind).toBe('new')
  })

  test('ESCALATED: warning → critical notifies regardless of cooldown', () => {
    const prev = rec({ severity: 'warning', notifiedAt: 4_900 })
    const { decision, next } = decideNotification(prev, 'critical', {
      now: 5_000, // 100ms later, well within any cooldown
      cooldownMs: DEFAULT_ALERT_COOLDOWN_MS,
    })
    expect(decision.notify).toBe(true)
    expect(decision.kind).toBe('escalated')
    expect(decision.previousSeverity).toBe('warning')
    expect(next?.severity).toBe('critical')
    expect(next?.notifiedAt).toBe(5_000)
  })

  test('COOLDOWN-SUPPRESSED: same severity within window is suppressed', () => {
    const prev = rec({ severity: 'critical', notifiedAt: 4_900 })
    const { decision, next } = decideNotification(prev, 'critical', {
      now: 5_000,
      cooldownMs: 10_000,
    })
    expect(decision.notify).toBe(false)
    expect(decision.kind).toBe('suppressed')
    // Timestamps preserved so the cooldown keeps counting from the last notify.
    expect(next).toEqual({
      severity: 'critical',
      updatedAt: 1_000,
      notifiedAt: 4_900,
    })
  })

  test('REMINDER: same severity past the cooldown re-notifies', () => {
    const prev = rec({ severity: 'critical', notifiedAt: 1_000 })
    const { decision, next } = decideNotification(prev, 'critical', {
      now: 20_000,
      cooldownMs: 10_000,
    })
    expect(decision.notify).toBe(true)
    expect(decision.kind).toBe('reminder')
    expect(next?.notifiedAt).toBe(20_000)
  })

  test('RECOVERY: firing → ok notifies once and clears state', () => {
    const prev = rec({ severity: 'critical' })
    const { decision, next } = decideNotification(prev, 'ok', { now: 9_000 })
    expect(decision.notify).toBe(true)
    expect(decision.kind).toBe('recovery')
    expect(decision.previousSeverity).toBe('critical')
    expect(next).toBeNull()
  })

  test('ok → ok is a silent no-op with no record kept', () => {
    const { decision, next } = decideNotification(undefined, 'ok')
    expect(decision.notify).toBe(false)
    expect(decision.kind).toBe('suppressed')
    expect(next).toBeNull()
  })

  test('DE-ESCALATION: critical → warning does not notify but lowers severity', () => {
    const prev = rec({ severity: 'critical', notifiedAt: 4_000 })
    const { decision, next } = decideNotification(prev, 'warning', {
      now: 5_000,
    })
    expect(decision.notify).toBe(false)
    expect(next?.severity).toBe('warning')
    // Cooldown timer is not reset on a downgrade.
    expect(next?.notifiedAt).toBe(4_000)
  })
})

describe('evaluateAlert + MemoryAlertStateStore', () => {
  test('full lifecycle: new → suppressed → reminder → recovery', () => {
    const store = new MemoryAlertStateStore()
    const base = {
      hostId: 0,
      ruleId: 'disk-usage',
      cooldownMs: 10_000,
    }

    // First sighting fires.
    const first = evaluateAlert(store, {
      ...base,
      severity: 'critical',
      now: 1_000,
    })
    first.commit()
    expect(first.decision.kind).toBe('new')

    // Persisting within cooldown is suppressed.
    const second = evaluateAlert(store, {
      ...base,
      severity: 'critical',
      now: 3_000,
    })
    second.commit()
    expect(second.decision.kind).toBe('suppressed')

    // Past the cooldown it reminds.
    const third = evaluateAlert(store, {
      ...base,
      severity: 'critical',
      now: 12_000,
    })
    third.commit()
    expect(third.decision.kind).toBe('reminder')

    // Recovery fires and clears the record.
    const recovery = evaluateAlert(store, {
      ...base,
      severity: 'ok',
      now: 13_000,
    })
    recovery.commit()
    expect(recovery.decision.kind).toBe('recovery')
    expect(store.get(alertStateKey(0, 'disk-usage'))).toBeUndefined()
  })

  test('escalation fires even inside the cooldown window', () => {
    const store = new MemoryAlertStateStore()
    const first = evaluateAlert(store, {
      hostId: 1,
      ruleId: 'replication-lag',
      severity: 'warning',
      now: 1_000,
      cooldownMs: 100_000,
    })
    first.commit()
    const { decision, commit } = evaluateAlert(store, {
      hostId: 1,
      ruleId: 'replication-lag',
      severity: 'critical',
      now: 1_500,
      cooldownMs: 100_000,
    })
    commit()
    expect(decision.kind).toBe('escalated')
    expect(decision.notify).toBe(true)
  })

  test('conditions on different hosts are isolated', () => {
    const store = new MemoryAlertStateStore()
    const a = evaluateAlert(store, {
      hostId: 0,
      ruleId: 'stuck-merges',
      severity: 'warning',
      now: 1,
    })
    a.commit()
    const b = evaluateAlert(store, {
      hostId: 1,
      ruleId: 'stuck-merges',
      severity: 'warning',
      now: 1,
    })
    b.commit()
    // Both are "new" because each host tracks its own state.
    expect(a.decision.kind).toBe('new')
    expect(b.decision.kind).toBe('new')
  })

  test('a failed delivery (no commit) does not suppress the next sweep', () => {
    const store = new MemoryAlertStateStore()
    const base = { hostId: 1, ruleId: 'cpu', cooldownMs: 60_000 }

    const first = evaluateAlert(store, {
      ...base,
      severity: 'critical',
      now: 1_000,
    })
    expect(first.decision.notify).toBe(true) // new critical → notify
    // simulate delivery FAILURE: do NOT commit

    const second = evaluateAlert(store, {
      ...base,
      severity: 'critical',
      now: 2_000,
    })
    expect(second.decision.notify).toBe(true) // retried, NOT suppressed
    second.commit() // delivery now succeeds

    const third = evaluateAlert(store, {
      ...base,
      severity: 'critical',
      now: 3_000,
    })
    // within cooldown after a committed notify → suppressed
    expect(third.decision.notify).toBe(false)
  })
})
