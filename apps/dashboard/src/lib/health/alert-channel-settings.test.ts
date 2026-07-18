/**
 * Gate-matrix tests for the ONE shared per-channel resolver (#2661).
 *
 * {@link resolveChannelDelivery} is the single pure function BOTH dispatch paths
 * (client `alert-dispatcher.ts`, server `server-sweep.ts`) call, so proving its
 * precedence here — global × channel × route × enabled, across both severities
 * — is what makes the per-path tests thin. Also covers {@link parseChannelSettings}
 * sanitization of untrusted localStorage / env input.
 */

import { describe, expect, test } from 'bun:test'
import {
  parseChannelSettings,
  resolveChannelDelivery,
  severityMeetsThreshold,
} from '@/lib/health/alert-channel-settings'

describe('severityMeetsThreshold', () => {
  test('warning floor lets warning and critical through', () => {
    expect(severityMeetsThreshold('warning', 'warning')).toBe(true)
    expect(severityMeetsThreshold('critical', 'warning')).toBe(true)
  })

  test('critical floor blocks warning, allows critical', () => {
    expect(severityMeetsThreshold('warning', 'critical')).toBe(false)
    expect(severityMeetsThreshold('critical', 'critical')).toBe(true)
  })
})

describe('resolveChannelDelivery — global gate only (no overrides)', () => {
  // With neither a channel nor a route override, the resolver reduces to the
  // historical single global gate — the pre-#2661 behaviour.
  const cases: Array<{
    severity: 'warning' | 'critical'
    global: 'warning' | 'critical'
    expected: boolean
  }> = [
    { severity: 'warning', global: 'warning', expected: true },
    { severity: 'critical', global: 'warning', expected: true },
    { severity: 'warning', global: 'critical', expected: false },
    { severity: 'critical', global: 'critical', expected: true },
  ]
  for (const c of cases) {
    test(`severity=${c.severity} global=${c.global} → ${c.expected}`, () => {
      expect(
        resolveChannelDelivery({
          severity: c.severity,
          globalMinSeverity: c.global,
        })
      ).toBe(c.expected)
    })
  }
})

describe('resolveChannelDelivery — a disabled channel NEVER fires', () => {
  test('enabled:false wins over every severity/threshold combination', () => {
    for (const severity of ['warning', 'critical'] as const) {
      for (const global of ['warning', 'critical'] as const) {
        expect(
          resolveChannelDelivery({
            severity,
            globalMinSeverity: global,
            channel: { enabled: false, minSeverity: 'warning' },
            // Even an explicit permissive route floor cannot re-enable it.
            routeMinSeverity: 'warning',
          })
        ).toBe(false)
      }
    }
  })

  test('enabled:true is a no-op (same as absent)', () => {
    expect(
      resolveChannelDelivery({
        severity: 'warning',
        globalMinSeverity: 'warning',
        channel: { enabled: true },
      })
    ).toBe(true)
  })
})

describe('resolveChannelDelivery — channel floor beats global', () => {
  test('channel critical restricts a warning that the global gate allows', () => {
    expect(
      resolveChannelDelivery({
        severity: 'warning',
        globalMinSeverity: 'warning',
        channel: { minSeverity: 'critical' },
      })
    ).toBe(false)
  })

  test('channel warning relaxes below a critical global gate', () => {
    expect(
      resolveChannelDelivery({
        severity: 'warning',
        globalMinSeverity: 'critical',
        channel: { minSeverity: 'warning' },
      })
    ).toBe(true)
  })
})

describe('resolveChannelDelivery — route floor beats channel and global', () => {
  test('route critical overrides a permissive channel + global', () => {
    expect(
      resolveChannelDelivery({
        severity: 'warning',
        globalMinSeverity: 'warning',
        channel: { minSeverity: 'warning' },
        routeMinSeverity: 'critical',
      })
    ).toBe(false)
  })

  test('route warning overrides a restrictive channel + global', () => {
    expect(
      resolveChannelDelivery({
        severity: 'warning',
        globalMinSeverity: 'critical',
        channel: { minSeverity: 'critical' },
        routeMinSeverity: 'warning',
      })
    ).toBe(true)
  })

  test('null route floor falls through to the channel floor', () => {
    expect(
      resolveChannelDelivery({
        severity: 'warning',
        globalMinSeverity: 'warning',
        channel: { minSeverity: 'critical' },
        routeMinSeverity: null,
      })
    ).toBe(false)
  })
})

describe('parseChannelSettings', () => {
  test('returns undefined for non-objects / empty input', () => {
    expect(parseChannelSettings(undefined)).toBeUndefined()
    expect(parseChannelSettings(null)).toBeUndefined()
    expect(parseChannelSettings('nope')).toBeUndefined()
    expect(parseChannelSettings({})).toBeUndefined()
  })

  test('keeps valid channel overrides, drops unknown ids and bad fields', () => {
    const parsed = parseChannelSettings({
      webhook: { enabled: false, minSeverity: 'critical' },
      telegram: { minSeverity: 'warning' },
      browser: { enabled: true },
      bogus: { enabled: false }, // unknown channel id → dropped
      email: { minSeverity: 'extreme' }, // invalid severity → whole entry dropped
      ntfy: { enabled: 'yes' }, // wrong type → dropped
    })
    expect(parsed).toEqual({
      webhook: { enabled: false, minSeverity: 'critical' },
      telegram: { minSeverity: 'warning' },
      browser: { enabled: true },
    })
  })

  test('drops an entry that has neither a valid enabled nor minSeverity', () => {
    expect(parseChannelSettings({ webhook: { foo: 1 } })).toBeUndefined()
  })
})
