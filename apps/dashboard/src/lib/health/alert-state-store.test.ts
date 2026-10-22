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

describe('decideNotification: repeat min delta (#4049)', () => {
  const HOUR = DEFAULT_ALERT_COOLDOWN_MS
  const past = rec({ notifiedAt: 0, lastNotifiedValue: 90 })
  const opts = { now: HOUR + 1, repeatMinDelta: 5 }

  test('suppresses a reminder when the value moved less than the delta, keeping notifiedAt', () => {
    const { decision, next } = decideNotification(past, 'warning', {
      ...opts,
      value: 92,
    })
    expect(decision.notify).toBe(false)
    expect(decision.kind).toBe('suppressed')
    expect(next?.notifiedAt).toBe(0)
    expect(next?.lastNotifiedValue).toBe(90)
  })

  test('reminds when the delta is met or exceeded, and records the new value', () => {
    const { decision, next } = decideNotification(past, 'warning', {
      ...opts,
      value: 95,
    })
    expect(decision.kind).toBe('reminder')
    expect(next?.notifiedAt).toBe(HOUR + 1)
    expect(next?.lastNotifiedValue).toBe(95)

    const down = decideNotification(past, 'warning', { ...opts, value: 80 })
    expect(down.decision.kind).toBe('reminder')
  })

  test('is off when repeatMinDelta is unset', () => {
    const { decision } = decideNotification(past, 'warning', {
      now: HOUR + 1,
      value: 90,
    })
    expect(decision.kind).toBe('reminder')
  })

  test('fails open without a stored value or with a non-finite value', () => {
    const noStored = decideNotification(rec({ notifiedAt: 0 }), 'warning', {
      ...opts,
      value: 90,
    })
    expect(noStored.decision.kind).toBe('reminder')

    for (const value of [null, undefined, Number.NaN]) {
      const { decision } = decideNotification(past, 'warning', {
        ...opts,
        value,
      })
      expect(decision.kind).toBe('reminder')
    }
  })

  test('never suppresses new, escalated or recovery', () => {
    const fresh = decideNotification(undefined, 'warning', {
      ...opts,
      value: 90,
    })
    expect(fresh.decision.kind).toBe('new')
    expect(fresh.next?.lastNotifiedValue).toBe(90)

    const esc = decideNotification(
      rec({ notifiedAt: HOUR, lastNotifiedValue: 90 }),
      'critical',
      { ...opts, value: 90.1 }
    )
    expect(esc.decision.kind).toBe('escalated')
    expect(esc.next?.lastNotifiedValue).toBe(90.1)

    const rcv = decideNotification(past, 'ok', { ...opts, value: 90 })
    expect(rcv.decision.kind).toBe('recovery')
    expect(rcv.next).toBeNull()
  })

  test('a sweep inside the cooldown does not overwrite the stored value', () => {
    const { next } = decideNotification(
      rec({ notifiedAt: 1_000, lastNotifiedValue: 90 }),
      'warning',
      { now: 2_000, value: 99, repeatMinDelta: 5 }
    )
    expect(next?.lastNotifiedValue).toBe(90)
  })

  test('evaluateAlert threads value and delta through commit', () => {
    const store = new MemoryAlertStateStore()
    const base = { hostId: 1, ruleId: 'cpu', severity: 'warning' as const }
    evaluateAlert(store, {
      ...base,
      now: 0,
      value: 90,
      repeatMinDelta: 5,
    }).commit()
    const r = evaluateAlert(store, {
      ...base,
      now: HOUR + 1,
      value: 91,
      repeatMinDelta: 5,
    })
    expect(r.decision.kind).toBe('suppressed')
  })
})

describe('repeat back-off (#4049)', () => {
  const HOUR = 3_600_000
  const base = { cooldownMs: HOUR, backoffMaxMs: 4 * HOUR }

  /** Sweep every 10 minutes from the first alert; return reminder offsets in hours. */
  function reminderHours(
    opts: Parameters<typeof decideNotification>[2],
    sweeps = 12 * 6,
    value: (i: number) => number = () => 50
  ): number[] {
    let state: AlertStateRecord | undefined
    const sent: number[] = []
    for (let i = 0; i <= sweeps; i++) {
      const now = i * 600_000
      const r = decideNotification(state, 'warning', {
        ...opts,
        now,
        value: value(i),
      })
      if (r.decision.notify) sent.push(now / HOUR)
      state = r.next ?? undefined
    }
    return sent
  }

  test('off by default: reminders keep the fixed cooldown', () => {
    expect(reminderHours({ cooldownMs: HOUR }, 6 * 6)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ])
    expect(
      reminderHours({ cooldownMs: HOUR, backoffMaxMs: null }, 6 * 6)
    ).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(reminderHours({ cooldownMs: HOUR, backoffMaxMs: 0 }, 6 * 6)).toEqual(
      [0, 1, 2, 3, 4, 5, 6]
    )
  })

  test('with a 4h cap and a 1h base the gaps go 1h, 2h, 4h, 4h', () => {
    // Sends at 0 (new), then +1h, +2h, +4h, +4h.
    expect(reminderHours(base, 15 * 6)).toEqual([0, 1, 3, 7, 11, 15])
  })

  test('the count grows only on a reminder that is actually sent', () => {
    const t0 = decideNotification(undefined, 'warning', { now: 0, ...base })
    expect(t0.next?.repeatCount).toBeUndefined()
    const r1 = decideNotification(t0.next ?? undefined, 'warning', {
      now: HOUR,
      ...base,
    })
    expect(r1.next?.repeatCount).toBe(1)
    const waiting = decideNotification(r1.next ?? undefined, 'warning', {
      now: HOUR + 600_000,
      ...base,
    })
    expect(waiting.decision.notify).toBe(false)
    expect(waiting.next?.repeatCount).toBe(1)
  })

  test('escalation resets the count and the interval', () => {
    const state = rec({ notifiedAt: 0, repeatCount: 2 })
    const r = decideNotification(state, 'critical', { now: 600_000, ...base })
    expect(r.decision.kind).toBe('escalated')
    expect(r.next?.repeatCount).toBeUndefined()
  })

  test('de-escalation and recovery drop the count', () => {
    const state = rec({ severity: 'critical', notifiedAt: 0, repeatCount: 2 })
    const down = decideNotification(state, 'warning', { now: 600_000, ...base })
    expect(down.next?.repeatCount).toBeUndefined()
    const ok = decideNotification(state, 'ok', { now: 600_000, ...base })
    expect(ok.decision.kind).toBe('recovery')
    expect(ok.next).toBeNull()
  })

  test('a value move of at least the delta resets the interval and the count', () => {
    const state = rec({
      notifiedAt: 0,
      repeatCount: 3,
      lastNotifiedValue: 50,
    })
    const opts = { ...base, repeatMinDelta: 10 }
    // 8h backed-off interval is capped at 4h, so 1h would normally wait.
    const flat = decideNotification(state, 'warning', {
      ...opts,
      now: HOUR,
      value: 55,
    })
    expect(flat.decision.notify).toBe(false)
    const moved = decideNotification(state, 'warning', {
      ...opts,
      now: HOUR,
      value: 60,
    })
    expect(moved.decision.kind).toBe('reminder')
    expect(moved.next?.repeatCount).toBeUndefined()
    expect(moved.next?.lastNotifiedValue).toBe(60)
  })

  test('a delta of 0 never counts as a move, so back-off still applies', () => {
    const state = rec({ notifiedAt: 0, repeatCount: 2, lastNotifiedValue: 50 })
    const r = decideNotification(state, 'warning', {
      ...base,
      repeatMinDelta: 0,
      now: 2 * HOUR,
      value: 99,
    })
    expect(r.decision.notify).toBe(false)
  })

  test('a huge count cannot overflow the interval and stays at the cap', () => {
    const state = rec({ notifiedAt: 0, repeatCount: 1e9 })
    const early = decideNotification(state, 'warning', {
      ...base,
      now: 4 * HOUR - 1,
    })
    expect(early.decision.notify).toBe(false)
    const due = decideNotification(state, 'warning', { ...base, now: 4 * HOUR })
    expect(due.decision.notify).toBe(true)
    expect(due.next?.repeatCount).toBeLessThanOrEqual(30)
  })

  test('the interval is never shorter than the base cooldown', () => {
    const state = rec({ notifiedAt: 0, repeatCount: 5 })
    const r = decideNotification(state, 'warning', {
      cooldownMs: 6 * HOUR,
      backoffMaxMs: HOUR,
      now: 5 * HOUR,
    })
    expect(r.decision.notify).toBe(false)
  })

  test('a cooldown of 0 (once until resolved) is untouched', () => {
    const state = rec({ notifiedAt: 0 })
    const r = decideNotification(state, 'warning', {
      cooldownMs: 0,
      backoffMaxMs: 4 * HOUR,
      now: 100 * HOUR,
    })
    expect(r.decision.notify).toBe(false)
    expect(r.next?.repeatCount).toBeUndefined()
  })

  test('a missing, negative or non-finite stored count counts as 0', () => {
    for (const repeatCount of [undefined, -4, Number.NaN]) {
      const state = rec({ notifiedAt: 0, repeatCount })
      const r = decideNotification(state, 'warning', { ...base, now: HOUR })
      expect(r.decision.kind).toBe('reminder')
      expect(r.next?.repeatCount).toBe(1)
    }
  })

  test('evaluateAlert threads backoffMaxMs through to the store', () => {
    const store = new MemoryAlertStateStore()
    const params = { hostId: 1, ruleId: 'r', severity: 'warning' as const }
    evaluateAlert(store, { ...params, now: 0, ...base }).commit()
    const second = evaluateAlert(store, { ...params, now: HOUR, ...base })
    second.commit()
    expect(store.get(alertStateKey(1, 'r'))?.repeatCount).toBe(1)
    expect(
      evaluateAlert(store, { ...params, now: 2 * HOUR, ...base }).decision
        .notify
    ).toBe(false)
  })
})

describe('first value of an incident (#4049)', () => {
  const T0 = 1_000_000
  test('is recorded on the first fire and kept through reminders and escalation', () => {
    const fired = decideNotification(undefined, 'warning', {
      now: T0,
      value: 80,
    })
    expect(fired.next?.firstValue).toBe(80)
    const reminder = decideNotification(fired.next ?? undefined, 'warning', {
      now: T0 + 2 * 3_600_000,
      value: 85,
    })
    expect(reminder.decision.kind).toBe('reminder')
    expect(reminder.next?.firstValue).toBe(80)
    const escalated = decideNotification(
      reminder.next ?? undefined,
      'critical',
      { now: T0 + 3 * 3_600_000, value: 95 }
    )
    expect(escalated.next?.firstValue).toBe(80)
  })
})
