/**
 * Tests for alert-settings-storage:
 *   - DEFAULT_ALERT_SETTINGS shape and new defaults
 *   - loadAlertSettings: no-op on server, returns defaults when empty, round-trips,
 *     merges partial stored values, and falls back on malformed JSON
 *   - saveAlertSettings: writes to localStorage and dispatches the change event
 *
 * These tests run in Bun's test runner, which does NOT provide a real browser
 * environment. We shim only what the module under test touches.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_ALERT_SETTINGS,
  loadAlertSettings,
  saveAlertSettings,
} from '@/lib/health/alert-settings-storage'

// ---------------------------------------------------------------------------
// localStorage shim
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
}

// ---------------------------------------------------------------------------
// DEFAULT_ALERT_SETTINGS
// ---------------------------------------------------------------------------

describe('DEFAULT_ALERT_SETTINGS', () => {
  test('browserNotificationsEnabled is true by default', () => {
    expect(DEFAULT_ALERT_SETTINGS.browserNotificationsEnabled).toBe(true)
  })

  test('webhook stays opt-in (disabled with empty URL)', () => {
    expect(DEFAULT_ALERT_SETTINGS.webhookEnabled).toBe(false)
    expect(DEFAULT_ALERT_SETTINGS.webhookUrl).toBe('')
  })

  test('default severity threshold is critical-only', () => {
    expect(DEFAULT_ALERT_SETTINGS.minSeverity).toBe('critical')
  })
})

// ---------------------------------------------------------------------------
// loadAlertSettings — server guard
// ---------------------------------------------------------------------------

describe('loadAlertSettings — server guard', () => {
  test('returns defaults when window is undefined (SSR / server context)', () => {
    // Simulate server: delete window temporarily
    const realWindow = globalThis.window
    // @ts-expect-error — intentionally deleting for SSR simulation
    delete globalThis.window
    try {
      const result = loadAlertSettings()
      expect(result).toEqual(DEFAULT_ALERT_SETTINGS)
    } finally {
      globalThis.window = realWindow
    }
  })
})

// ---------------------------------------------------------------------------
// loadAlertSettings / saveAlertSettings — browser environment
// ---------------------------------------------------------------------------

describe('loadAlertSettings — browser environment', () => {
  let ls: Storage

  beforeEach(() => {
    ls = makeLocalStorage()
    globalThis.window = {
      localStorage: ls,
      dispatchEvent: () => true,
    } as unknown as Window & typeof globalThis
    Object.defineProperty(globalThis, 'localStorage', {
      value: ls,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    // @ts-expect-error — restore
    delete globalThis.window
  })

  test('returns DEFAULT_ALERT_SETTINGS when storage is empty', () => {
    const result = loadAlertSettings()
    expect(result).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  test('round-trips a full AlertSettings object through save → load', () => {
    const custom = {
      webhookUrl: 'https://hooks.slack.com/test',
      webhookEnabled: true,
      healthchecksUrl: 'https://hc-ping.com/abc123',
      browserNotificationsEnabled: false,
      minSeverity: 'warning' as const,
    }
    saveAlertSettings(custom)
    const result = loadAlertSettings()
    expect(result).toEqual(custom)
  })

  test('falls back to default for each missing field in partial stored value', () => {
    ls.setItem(
      'health-alert-settings',
      JSON.stringify({ minSeverity: 'warning' })
    )
    const result = loadAlertSettings()
    // Only minSeverity was stored; other fields must fall back to defaults
    expect(result.minSeverity).toBe('warning')
    expect(result.webhookUrl).toBe(DEFAULT_ALERT_SETTINGS.webhookUrl)
    expect(result.webhookEnabled).toBe(DEFAULT_ALERT_SETTINGS.webhookEnabled)
    expect(result.browserNotificationsEnabled).toBe(
      DEFAULT_ALERT_SETTINGS.browserNotificationsEnabled
    )
  })

  test('falls back to defaults on malformed JSON', () => {
    ls.setItem('health-alert-settings', '{not valid json}}}')
    const result = loadAlertSettings()
    expect(result).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  test('falls back to defaults when stored value has wrong types', () => {
    ls.setItem(
      'health-alert-settings',
      JSON.stringify({
        webhookUrl: 42, // wrong type
        webhookEnabled: 'yes', // wrong type
        browserNotificationsEnabled: 1, // wrong type
        minSeverity: 'extreme', // invalid enum value
      })
    )
    const result = loadAlertSettings()
    expect(result).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  test('round-trips a per-channel overrides map (#2661)', () => {
    saveAlertSettings({
      ...DEFAULT_ALERT_SETTINGS,
      channels: {
        webhook: { enabled: false },
        healthchecks: { minSeverity: 'critical' },
      },
    })
    const result = loadAlertSettings()
    expect(result.channels).toEqual({
      webhook: { enabled: false },
      healthchecks: { minSeverity: 'critical' },
    })
  })

  test('omits channels entirely when none are stored (default shape)', () => {
    const result = loadAlertSettings()
    expect('channels' in result).toBe(false)
  })

  test('sanitizes a malformed channels map, dropping bad entries', () => {
    ls.setItem(
      'health-alert-settings',
      JSON.stringify({
        ...DEFAULT_ALERT_SETTINGS,
        channels: {
          webhook: { minSeverity: 'critical' },
          bogus: { enabled: false },
          email: { minSeverity: 'extreme' },
        },
      })
    )
    const result = loadAlertSettings()
    expect(result.channels).toEqual({ webhook: { minSeverity: 'critical' } })
  })

  test('accepts explicit browserNotificationsEnabled: false (user opt-out)', () => {
    ls.setItem(
      'health-alert-settings',
      JSON.stringify({
        ...DEFAULT_ALERT_SETTINGS,
        browserNotificationsEnabled: false,
      })
    )
    const result = loadAlertSettings()
    expect(result.browserNotificationsEnabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveAlertSettings — dispatches change event
// ---------------------------------------------------------------------------

describe('saveAlertSettings', () => {
  let ls: Storage
  let dispatchedEvents: Event[]

  beforeEach(() => {
    ls = makeLocalStorage()
    dispatchedEvents = []
    globalThis.window = {
      localStorage: ls,
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event)
        return true
      },
      CustomEvent: class CustomEvent extends Event {
        constructor(type: string, _init?: EventInit) {
          super(type)
        }
      },
    } as unknown as Window & typeof globalThis
    Object.defineProperty(globalThis, 'localStorage', {
      value: ls,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis, 'CustomEvent', {
      value: globalThis.window.CustomEvent,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    // @ts-expect-error — restore
    delete globalThis.window
  })

  test('returns false when window is undefined (server)', () => {
    const realWindow = globalThis.window
    // @ts-expect-error
    delete globalThis.window
    try {
      expect(saveAlertSettings(DEFAULT_ALERT_SETTINGS)).toBe(false)
    } finally {
      globalThis.window = realWindow
    }
  })

  test('returns true and persists to localStorage', () => {
    const ok = saveAlertSettings(DEFAULT_ALERT_SETTINGS)
    expect(ok).toBe(true)
    const stored = ls.getItem('health-alert-settings')
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toEqual(DEFAULT_ALERT_SETTINGS)
  })

  test('dispatches health-alert-settings-changed event', () => {
    saveAlertSettings(DEFAULT_ALERT_SETTINGS)
    expect(dispatchedEvents.length).toBeGreaterThan(0)
    expect(dispatchedEvents[0].type).toBe('health-alert-settings-changed')
  })
})
