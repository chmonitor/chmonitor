/**
 * Tests for fleet-helpers.ts — Fleet view-mode persistence and metric
 * formatting. Stubs `window.localStorage` via globalThis (bun test has no DOM),
 * covering the round-trip, the corrupt-value / SSR guards, and throwing storage.
 */

import {
  DEFAULT_FLEET_VIEW,
  FLEET_VIEW_STORAGE_KEY,
  formatCount,
  parseFleetView,
  readFleetView,
  writeFleetView,
} from './fleet-helpers'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

function makeLocalStorageStub() {
  const store: Record<string, string> = {}
  return {
    store,
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
  }
}

function setWindowLocalStorage(localStorage: unknown) {
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  setWindowLocalStorage(makeLocalStorageStub())
})

afterEach(() => {
  try {
    delete (globalThis as Record<string, unknown>).window
  } catch {
    // ignore
  }
})

describe('parseFleetView', () => {
  test('accepts the two valid views', () => {
    expect(parseFleetView('grid')).toBe('grid')
    expect(parseFleetView('table')).toBe('table')
  })

  test('falls back to the default for junk / null / undefined', () => {
    expect(parseFleetView(null)).toBe(DEFAULT_FLEET_VIEW)
    expect(parseFleetView(undefined)).toBe(DEFAULT_FLEET_VIEW)
    expect(parseFleetView('cards')).toBe(DEFAULT_FLEET_VIEW)
    expect(parseFleetView('')).toBe(DEFAULT_FLEET_VIEW)
  })

  test('default is grid', () => {
    expect(DEFAULT_FLEET_VIEW).toBe('grid')
  })
})

describe('read/writeFleetView', () => {
  test('defaults to grid when nothing persisted', () => {
    expect(readFleetView()).toBe('grid')
  })

  test('round-trips a written value', () => {
    writeFleetView('table')
    expect(window.localStorage.getItem(FLEET_VIEW_STORAGE_KEY)).toBe('table')
    expect(readFleetView()).toBe('table')

    writeFleetView('grid')
    expect(readFleetView()).toBe('grid')
  })

  test('read tolerates a corrupt stored value', () => {
    window.localStorage.setItem(FLEET_VIEW_STORAGE_KEY, 'nonsense')
    expect(readFleetView()).toBe('grid')
  })

  test('returns default off-DOM (SSR)', () => {
    delete (globalThis as Record<string, unknown>).window
    expect(readFleetView()).toBe('grid')
    expect(() => writeFleetView('table')).not.toThrow()
  })

  test('read returns default when storage throws', () => {
    setWindowLocalStorage({
      getItem: () => {
        throw new Error('disabled')
      },
    })
    expect(readFleetView()).toBe('grid')
  })

  test('write silently ignores a throwing storage', () => {
    setWindowLocalStorage({
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => writeFleetView('table')).not.toThrow()
  })
})

describe('formatCount', () => {
  test('renders an en-dash for absent / non-finite values', () => {
    expect(formatCount(undefined)).toBe('—')
    expect(formatCount(null)).toBe('—')
    expect(formatCount(Number.NaN)).toBe('—')
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—')
  })

  test('renders zero and grouped integers', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(42)).toBe('42')
    expect(formatCount(1234567)).toBe((1234567).toLocaleString())
  })

  test('truncates fractional values', () => {
    expect(formatCount(12.9)).toBe('12')
  })
})
