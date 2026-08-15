/**
 * Pure UI logic behind the redesigned alert settings: the browser channel's
 * status line and the threshold stepper's magnitude-aware step.
 *
 * Both are small, but both encode a bug that shipped: a status line that
 * conflated "enabled" with "delivering", and a spinner whose fixed step of 1
 * made a threshold of 300 unusable.
 */

import { browserStatus } from '../alert-channels-panel'
import { stepFor } from '../threshold-field'
import { describe, expect, test } from 'bun:test'

const permission = (
  state: 'unsupported' | 'default' | 'granted' | 'denied'
) => ({
  state,
  canNotify: state === 'granted',
  isBlocked: state === 'denied',
  request: async () => state,
})

describe('browserStatus', () => {
  test('enabled but ungranted does NOT read as delivering', () => {
    // The exact desync the redesign fixes: the stored preference defaults to
    // true, so this state is what a fresh install actually shows.
    expect(browserStatus(true, permission('default'))).toBe(
      'Permission not granted yet'
    )
  })

  test('only enabled AND granted reads as delivering', () => {
    expect(browserStatus(true, permission('granted'))).toBe('Delivering')
  })

  test('a granted permission with the toggle off still reads as disabled', () => {
    expect(browserStatus(false, permission('granted'))).toBe('Disabled')
  })

  test('a browser-level block outranks the stored preference', () => {
    // Both directions — the operator must see "blocked", not "disabled",
    // because only browser settings can undo it.
    expect(browserStatus(true, permission('denied'))).toBe(
      'Blocked in browser settings'
    )
    expect(browserStatus(false, permission('denied'))).toBe(
      'Blocked in browser settings'
    )
  })

  test('an unsupported browser says so rather than showing a toggle state', () => {
    expect(browserStatus(true, permission('unsupported'))).toBe(
      'Not supported in this browser'
    )
  })
})

describe('stepFor', () => {
  test('scales with magnitude instead of a fixed step of 1', () => {
    expect(stepFor(0.5)).toBe(0.1)
    expect(stepFor(3)).toBe(1)
    expect(stepFor(20)).toBe(5)
    expect(stepFor(150)).toBe(10)
    expect(stepFor(300)).toBe(50)
    expect(stepFor(5000)).toBe(100)
  })

  test('a step is always positive, so a nudge always moves the value', () => {
    for (const value of [0, 0.1, 1, 9.99, 49, 199, 999, 1e6]) {
      expect(stepFor(value)).toBeGreaterThan(0)
    }
  })

  test('is monotonic — a bigger threshold never gets a smaller step', () => {
    const values = [0, 0.5, 1, 5, 10, 49, 50, 150, 199, 200, 999, 1000, 5000]
    for (let i = 1; i < values.length; i++) {
      expect(stepFor(values[i])).toBeGreaterThanOrEqual(stepFor(values[i - 1]))
    }
  })

  test('treats a negative value by magnitude', () => {
    expect(stepFor(-300)).toBe(stepFor(300))
  })
})
