/**
 * State-transition tests for the alert de-dup store. No mocks — exercises the
 * pure decision function and the read/decide/persist wrapper against the memory
 * backend, covering: new, escalated, cooldown-suppressed, reminder (post
 * cooldown), and recovery.
 */

import type { AlertRuleSeverity } from '@/lib/alerting/rule-registry'
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
      // A newly-firing condition stamps the incident start for duration reporting.
      firstFiredAt: 5_000,
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

describe('hysteresis (#2767)', () => {
  test('breach hysteresis: a lone blip is held, not fired', () => {
    // minConsecutiveBreaches=2 → first warning is a pending hold, no notify.
    const first = decideNotification(undefined, 'warning', {
      now: 1_000,
      minConsecutiveBreaches: 2,
    })
    expect(first.decision.notify).toBe(false)
    expect(first.decision.kind).toBe('suppressed')
    expect(first.next).toMatchObject({
      severity: 'ok',
      pendingSeverity: 'warning',
      pendingCount: 1,
    })

    // A single ok read clears the pending streak — the blip is forgotten.
    const cleared = decideNotification(first.next ?? undefined, 'ok', {
      now: 2_000,
      minConsecutiveBreaches: 2,
    })
    expect(cleared.decision.notify).toBe(false)
    expect(cleared.next).toBeNull()
  })

  test('breach hysteresis: fires only after N consecutive breaches', () => {
    const a = decideNotification(undefined, 'critical', {
      now: 1_000,
      minConsecutiveBreaches: 3,
    })
    expect(a.decision.notify).toBe(false)
    expect(a.next?.pendingCount).toBe(1)

    const b = decideNotification(a.next ?? undefined, 'critical', {
      now: 2_000,
      minConsecutiveBreaches: 3,
    })
    expect(b.decision.notify).toBe(false)
    expect(b.next?.pendingCount).toBe(2)

    const c = decideNotification(b.next ?? undefined, 'critical', {
      now: 3_000,
      minConsecutiveBreaches: 3,
    })
    expect(c.decision.notify).toBe(true)
    expect(c.decision.kind).toBe('new')
    expect(c.next?.severity).toBe('critical')
    expect(c.next?.pendingSeverity).toBeUndefined()
    expect(c.next?.firstFiredAt).toBe(3_000)
  })

  test('clear hysteresis: a single dip below threshold does not recover', () => {
    const firing: AlertStateRecord = {
      severity: 'critical',
      updatedAt: 1_000,
      notifiedAt: 1_000,
      firstFiredAt: 1_000,
    }
    // First ok read is held (needs 2 consecutive clears).
    const dip = decideNotification(firing, 'ok', {
      now: 2_000,
      minConsecutiveClears: 2,
    })
    expect(dip.decision.notify).toBe(false)
    expect(dip.next).toMatchObject({
      severity: 'critical',
      firstFiredAt: 1_000,
      pendingSeverity: 'ok',
      pendingCount: 1,
    })

    // Second consecutive ok read recovers, reporting the incident duration.
    const recover = decideNotification(dip.next ?? undefined, 'ok', {
      now: 3_000,
      minConsecutiveClears: 2,
    })
    expect(recover.decision.notify).toBe(true)
    expect(recover.decision.kind).toBe('recovery')
    expect(recover.decision.incidentDurationMs).toBe(2_000)
    expect(recover.next).toBeNull()
  })

  test('recovery carries incident duration from firstFiredAt', () => {
    const firing: AlertStateRecord = {
      severity: 'warning',
      updatedAt: 10_000,
      notifiedAt: 10_000,
      firstFiredAt: 10_000,
    }
    const { decision } = decideNotification(firing, 'ok', { now: 70_000 })
    expect(decision.kind).toBe('recovery')
    expect(decision.incidentDurationMs).toBe(60_000)
  })

  test('flap sequence: with damping, exactly one fire + one recover', () => {
    const store = new MemoryAlertStateStore()
    const base = {
      hostId: 0,
      ruleId: 'disk-usage',
      cooldownMs: 10_000_000, // large so no reminders interfere
      minConsecutiveBreaches: 1,
      minConsecutiveClears: 2,
    }
    // Alternating warning/ok every sweep — a classic flap around the threshold.
    const severities: AlertRuleSeverity[] = [
      'warning',
      'ok',
      'warning',
      'ok',
      'warning',
      'ok',
      'ok', // sustained recovery: two consecutive clears at the end
    ]
    const kinds: string[] = []
    let now = 1_000
    for (const severity of severities) {
      const { decision, commit } = evaluateAlert(store, {
        ...base,
        severity,
        now,
      })
      commit()
      if (decision.notify) kinds.push(decision.kind)
      now += 1_000
    }
    // Damping (clear hysteresis) bridges the single-sweep dips, so the whole
    // flap collapses to one fire and one recover — the #2767 success criterion.
    expect(kinds.filter((k) => k === 'new').length).toBe(1)
    expect(kinds.filter((k) => k === 'recovery').length).toBe(1)
    expect(kinds).toEqual(['new', 'recovery'])
  })

  test('default (1/1) hysteresis preserves the pre-#2767 transitions', () => {
    // No hysteresis options → fire on first breach, recover on first clear.
    const fire = decideNotification(undefined, 'warning', { now: 1_000 })
    expect(fire.decision.kind).toBe('new')
    const recover = decideNotification(fire.next ?? undefined, 'ok', {
      now: 2_000,
    })
    expect(recover.decision.kind).toBe('recovery')
    expect(recover.next).toBeNull()
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
