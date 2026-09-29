/**
 * #3495 — the tri-state every alert panel reads. The rules that matter:
 * a 501 always wins (the probe can only restrict), and anything short of a
 * positively-known backend is NOT `available`.
 */

import { resolveHealthStoreAvailability } from './store-availability'
import { describe, expect, test } from 'bun:test'

const D1 = { backend: 'd1', maintenanceWindowsBackend: 'd1' } as const
const NONE = { backend: 'none', maintenanceWindowsBackend: 'none' } as const
const notConfigured = { status: 501 }

describe('resolveHealthStoreAvailability', () => {
  test('config not loaded yet is unknown', () => {
    expect(
      resolveHealthStoreAvailability({ capability: D1, configLoading: true })
    ).toBe('unknown')
  })

  test('config failed / field absent is unknown', () => {
    expect(
      resolveHealthStoreAvailability({
        capability: undefined,
        configLoading: false,
      })
    ).toBe('unknown')
  })

  test('a 501 probe vetoes a declared backend', () => {
    for (const configLoading of [true, false])
      for (const capability of [D1, NONE, undefined])
        expect(
          resolveHealthStoreAvailability({
            capability,
            configLoading,
            probeError: notConfigured,
          })
        ).toBe('unavailable')
  })

  test('a non-501 probe error does not override the declared answer', () => {
    expect(
      resolveHealthStoreAvailability({
        capability: D1,
        configLoading: false,
        probeError: { status: 500 },
      })
    ).toBe('available')
    expect(
      resolveHealthStoreAvailability({
        capability: NONE,
        configLoading: false,
        probeError: { status: 500 },
      })
    ).toBe('unavailable')
  })

  test('maintenance windows read their own backend', () => {
    const cap = { backend: 'none', maintenanceWindowsBackend: 'd1' } as const
    expect(
      resolveHealthStoreAvailability({ capability: cap, configLoading: false })
    ).toBe('unavailable')
    expect(
      resolveHealthStoreAvailability({
        capability: cap,
        configLoading: false,
        store: 'maintenanceWindows',
      })
    ).toBe('available')
  })
})
