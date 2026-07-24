/**
 * Outage escalation — the reminder schedule, recovery accounting, and the
 * guarantee that we never double-alert the initial "is DOWN".
 */

import type { OutageState } from './outage'
import type { ProbeResult } from './probes'

import {
  ESCALATION_STEPS_MS,
  formatDuration,
  formatOutageAlert,
  nextReminderAt,
  reconcileOutages,
} from './outage'
import { describe, expect, test } from 'bun:test'

const T0 = Date.parse('2026-07-25T02:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const down = (name = 'dashboard'): ProbeResult => ({
  name,
  state: 'down',
  status: 503,
})
const up = (name = 'dashboard'): ProbeResult => ({ name, state: 'up' })

describe('formatDuration', () => {
  test('reads naturally at each scale', () => {
    expect(formatDuration(45 * MINUTE)).toBe('45m')
    expect(formatDuration(2 * HOUR + 15 * MINUTE)).toBe('2h 15m')
    expect(formatDuration(27 * HOUR)).toBe('1d 3h')
  })
})

describe('escalation schedule', () => {
  test('widens rather than repeating at a fixed interval', () => {
    // The first hour matters most; an outage you have been told about four
    // times does not need a fifth reminder every 15 minutes.
    const gaps = ESCALATION_STEPS_MS.map((step, i) =>
      i === 0 ? step : step - ESCALATION_STEPS_MS[i - 1]
    )
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1])
    }
  })

  test('past the last step, reminders keep coming at the final interval', () => {
    const last = ESCALATION_STEPS_MS.length
    const at = nextReminderAt({
      downSince: T0,
      lastAlertAt: T0,
      reminders: last,
    })
    expect(at).toBeGreaterThan(T0 + ESCALATION_STEPS_MS[last - 1])
  })
})

describe('reconcileOutages', () => {
  test('the first time down only starts the clock — diffStates owns that alert', () => {
    // Alerting here too would send two messages for one event.
    const { alerts, next } = reconcileOutages({}, [down()], T0)
    expect(alerts).toEqual([])
    expect(next.dashboard.downSince).toBe(T0)
    expect(next.dashboard.reminders).toBe(0)
  })

  test('stays quiet until the first step elapses, then reminds', () => {
    const prev: OutageState = {
      dashboard: { downSince: T0, lastAlertAt: T0, reminders: 0 },
    }
    const tooSoon = reconcileOutages(prev, [down()], T0 + 15 * MINUTE)
    expect(tooSoon.alerts).toEqual([])

    const due = reconcileOutages(prev, [down()], T0 + ESCALATION_STEPS_MS[0])
    expect(due.alerts).toHaveLength(1)
    expect(due.alerts[0].kind).toBe('ongoing')
    expect(due.next.dashboard.reminders).toBe(1)
  })

  test('an ongoing reminder carries how long it has been down', () => {
    const prev: OutageState = {
      dashboard: { downSince: T0, lastAlertAt: T0, reminders: 0 },
    }
    const { alerts } = reconcileOutages(prev, [down()], T0 + 2 * HOUR)
    expect(alerts[0].downtimeMs).toBe(2 * HOUR)
    expect(formatOutageAlert(alerts[0])).toContain('STILL DOWN — 2h 0m')
  })

  test('recovery reports total downtime exactly once, then forgets', () => {
    const prev: OutageState = {
      dashboard: { downSince: T0, lastAlertAt: T0, reminders: 2 },
    }
    const { alerts, next } = reconcileOutages(prev, [up()], T0 + 3 * HOUR)
    expect(alerts).toHaveLength(1)
    expect(formatOutageAlert(alerts[0])).toContain('RECOVERED — was down 3h 0m')
    // Dropped from state, so a later run cannot report it again.
    expect(next.dashboard).toBeUndefined()

    const after = reconcileOutages(next, [up()], T0 + 4 * HOUR)
    expect(after.alerts).toEqual([])
  })

  test('a healthy surface that was never down produces nothing', () => {
    expect(reconcileOutages({}, [up()], T0).alerts).toEqual([])
  })

  test('tracks several simultaneous outages independently', () => {
    // A multi-surface incident is exactly the case the old per-kind throttle
    // collapsed into a single message.
    const prev: OutageState = {
      dashboard: { downSince: T0, lastAlertAt: T0, reminders: 0 },
      docs: { downSince: T0 + HOUR, lastAlertAt: T0 + HOUR, reminders: 0 },
    }
    const { alerts } = reconcileOutages(
      prev,
      [down('dashboard'), down('docs')],
      T0 + HOUR + ESCALATION_STEPS_MS[0]
    )
    // dashboard is well past its step; docs just reached its own first step.
    expect(alerts.map((a) => a.name).sort()).toEqual(['dashboard', 'docs'])
    expect(
      alerts.find((a) => a.name === 'dashboard')?.downtimeMs
    ).toBeGreaterThan(alerts.find((a) => a.name === 'docs')?.downtimeMs ?? 0)
  })
})
