/**
 * Tests for isHealthSweepEnabled — the scheduled health-sweep enablement gate
 * (issue #2666). Encodes the resolution contract the cron dispatch depends on:
 *   - explicit CHM_HEALTH_SWEEP_ENABLED wins (truthy → run, falsy → skip)
 *   - unset/junk falls back to the CRON_SECRET posture (fail-closed)
 *
 * Pure function, so drive it with a plain map-backed env getter — no process.env
 * or worker-binding mocking needed.
 */

import { isHealthSweepEnabled } from './sweep-schedule'
import { describe, expect, test } from 'bun:test'

function getter(env: Record<string, string | undefined>) {
  return (key: string) => env[key]
}

describe('isHealthSweepEnabled', () => {
  describe('explicit CHM_HEALTH_SWEEP_ENABLED overrides the default', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      test(`truthy "${v}" → enabled (even without CRON_SECRET)`, () => {
        expect(
          isHealthSweepEnabled(getter({ CHM_HEALTH_SWEEP_ENABLED: v }))
        ).toBe(true)
      })
    }

    for (const v of ['0', 'false', 'FALSE', 'no', 'off']) {
      test(`falsy "${v}" → disabled (even with CRON_SECRET set)`, () => {
        expect(
          isHealthSweepEnabled(
            getter({ CHM_HEALTH_SWEEP_ENABLED: v, CRON_SECRET: 's3cret' })
          )
        ).toBe(false)
      })
    }
  })

  describe('default (flag unset/junk) follows the CRON_SECRET posture', () => {
    test('CRON_SECRET set → enabled', () => {
      expect(isHealthSweepEnabled(getter({ CRON_SECRET: 's3cret' }))).toBe(true)
    })

    test('CRON_SECRET unset → disabled (fail-closed)', () => {
      expect(isHealthSweepEnabled(getter({}))).toBe(false)
    })

    test('CRON_SECRET empty/whitespace → disabled', () => {
      expect(isHealthSweepEnabled(getter({ CRON_SECRET: '   ' }))).toBe(false)
    })

    test('unrecognized flag value → falls through to CRON_SECRET default', () => {
      expect(
        isHealthSweepEnabled(
          getter({ CHM_HEALTH_SWEEP_ENABLED: 'maybe', CRON_SECRET: 's3cret' })
        )
      ).toBe(true)
      expect(
        isHealthSweepEnabled(getter({ CHM_HEALTH_SWEEP_ENABLED: 'maybe' }))
      ).toBe(false)
    })
  })
})
