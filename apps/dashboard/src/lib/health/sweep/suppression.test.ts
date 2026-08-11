/**
 * Unit tests for the sweep's suppression predicates (#2884).
 *
 * These are the gates that decide whether a classified finding ever reaches a
 * channel. Before the pipeline split they could only be exercised end-to-end
 * through `runHealthSweep` (with D1 + fetch mocked); here each outcome the
 * `SweepSummary` counters report — below-min-severity, maintenance window,
 * quiet hours, acked, deduped/cooldown, and the pass-through — is asserted
 * directly on a pure function.
 */

import type { AlertAck } from './../alert-ack-store'
import type { MaintenanceWindow } from './../maintenance-windows'
import type { QuietHours } from './../quiet-hours'

import {
  effectiveSeverity,
  isAckGated,
  isMaintenanceGated,
  isQuietHoursGated,
  meetsMinSeverity,
  SEVERITY_ORDER,
} from './suppression'
import { describe, expect, test } from 'bun:test'

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)

function maintenanceWindow(
  over: Partial<MaintenanceWindow> = {}
): MaintenanceWindow {
  return {
    id: 'w1',
    ownerId: '',
    hostId: null,
    reason: 'patching',
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    createdBy: 'ops',
    createdAt: NOW,
    ...over,
  }
}

/** A quiet-hours window covering every weekday, all day, in UTC. */
function quietWindow(over: Partial<QuietHours> = {}): QuietHours {
  return {
    id: 'q1',
    ownerId: '',
    days: [0, 1, 2, 3, 4, 5, 6],
    start: '00:00',
    end: '23:59',
    timezone: 'UTC',
    severityCap: null,
    createdBy: 'ops',
    createdAt: NOW,
    ...over,
  }
}

function ack(over: Partial<AlertAck> = {}): AlertAck {
  return {
    ownerId: '',
    hostId: 1,
    ruleId: 'disk-usage',
    ackedBy: 'ops',
    ackedAt: NOW,
    expiresAt: NOW + 60_000,
    note: '',
    ...over,
  }
}

describe('severity gate', () => {
  test('ranks ok < warning < critical', () => {
    expect(SEVERITY_ORDER.ok).toBeLessThan(SEVERITY_ORDER.warning)
    expect(SEVERITY_ORDER.warning).toBeLessThan(SEVERITY_ORDER.critical)
  })

  test('below the minimum severity does not pass', () => {
    expect(meetsMinSeverity('warning', 'critical')).toBe(false)
    expect(meetsMinSeverity('ok', 'warning')).toBe(false)
  })

  test('at or above the minimum severity passes', () => {
    expect(meetsMinSeverity('warning', 'warning')).toBe(true)
    expect(meetsMinSeverity('critical', 'warning')).toBe(true)
    expect(meetsMinSeverity('critical', 'critical')).toBe(true)
  })

  test('a sub-threshold severity collapses to ok for the dedup store', () => {
    expect(effectiveSeverity('warning', 'critical')).toBe('ok')
    // …and one that clears the gate is tracked as itself.
    expect(effectiveSeverity('warning', 'warning')).toBe('warning')
    expect(effectiveSeverity('critical', 'critical')).toBe('critical')
  })
})

describe('isMaintenanceGated', () => {
  test('suppresses inside an active window', () => {
    expect(
      isMaintenanceGated({
        notify: true,
        windows: [maintenanceWindow()],
        hostId: 1,
        now: NOW,
      })
    ).toBe(true)
  })

  test('passes through outside any window', () => {
    expect(
      isMaintenanceGated({
        notify: true,
        windows: [maintenanceWindow({ endsAt: NOW - 1_000 })],
        hostId: 1,
        now: NOW,
      })
    ).toBe(false)
  })

  test('never gates a non-notifying decision (nothing to suppress)', () => {
    expect(
      isMaintenanceGated({
        notify: false,
        windows: [maintenanceWindow()],
        hostId: 1,
        now: NOW,
      })
    ).toBe(false)
  })
})

describe('isQuietHoursGated', () => {
  test('suppresses a warning inside an active window', () => {
    expect(
      isQuietHoursGated({
        notify: true,
        isRecovery: false,
        effective: 'warning',
        quietHours: [quietWindow()],
        now: NOW,
      })
    ).toBe(true)
  })

  test('lets a critical through when the window caps at critical', () => {
    expect(
      isQuietHoursGated({
        notify: true,
        isRecovery: false,
        effective: 'critical',
        quietHours: [quietWindow({ severityCap: 'critical' })],
        now: NOW,
      })
    ).toBe(false)
  })

  test('never gates a recovery', () => {
    expect(
      isQuietHoursGated({
        notify: true,
        isRecovery: true,
        effective: 'critical',
        quietHours: [quietWindow()],
        now: NOW,
      })
    ).toBe(false)
  })

  test('passes through with no configured windows', () => {
    expect(
      isQuietHoursGated({
        notify: true,
        isRecovery: false,
        effective: 'warning',
        quietHours: [],
        now: NOW,
      })
    ).toBe(false)
  })
})

describe('isAckGated', () => {
  test('suppresses a notifying alert with an unexpired ACK', () => {
    expect(
      isAckGated({
        notify: true,
        isRecovery: false,
        acks: [ack()],
        hostId: 1,
        ruleId: 'disk-usage',
        now: NOW,
      })
    ).toBe(true)
  })

  test('an expired ACK no longer suppresses', () => {
    expect(
      isAckGated({
        notify: true,
        isRecovery: false,
        acks: [ack({ expiresAt: NOW - 1 })],
        hostId: 1,
        ruleId: 'disk-usage',
        now: NOW,
      })
    ).toBe(false)
  })

  test('never gates a recovery (it clears the ACK instead)', () => {
    expect(
      isAckGated({
        notify: true,
        isRecovery: true,
        acks: [ack()],
        hostId: 1,
        ruleId: 'disk-usage',
        now: NOW,
      })
    ).toBe(false)
  })

  test('an ACK for another rule/host does not suppress', () => {
    expect(
      isAckGated({
        notify: true,
        isRecovery: false,
        acks: [ack({ ruleId: 'other-rule' })],
        hostId: 1,
        ruleId: 'disk-usage',
        now: NOW,
      })
    ).toBe(false)
  })
})

describe('deduped / within-cooldown decisions', () => {
  // "Within cooldown" is owned by `evaluateAlert`, which reports it as
  // `notify: false`. Every dispatch-time gate must then be inert — the sweep
  // counts it as `alertsSuppressed` and commits, it never delivers.
  test('no gate fires for a non-notifying decision', () => {
    const common = { notify: false, hostId: 1, ruleId: 'disk-usage', now: NOW }
    expect(
      isMaintenanceGated({ ...common, windows: [maintenanceWindow()] })
    ).toBe(false)
    expect(
      isQuietHoursGated({
        ...common,
        isRecovery: false,
        effective: 'critical',
        quietHours: [quietWindow()],
      })
    ).toBe(false)
    expect(isAckGated({ ...common, isRecovery: false, acks: [ack()] })).toBe(
      false
    )
  })
})

describe('pass-through', () => {
  test('a notifying finding with no windows and no ACK is not gated', () => {
    const common = { notify: true, hostId: 1, ruleId: 'disk-usage', now: NOW }
    expect(isMaintenanceGated({ ...common, windows: [] })).toBe(false)
    expect(
      isQuietHoursGated({
        ...common,
        isRecovery: false,
        effective: 'critical',
        quietHours: [],
      })
    ).toBe(false)
    expect(isAckGated({ ...common, isRecovery: false, acks: [] })).toBe(false)
  })
})
