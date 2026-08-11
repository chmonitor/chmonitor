/**
 * Tests for fleet-helpers.ts — Fleet view-mode persistence and metric
 * formatting. Stubs `window.localStorage` via globalThis (bun test has no DOM),
 * covering the round-trip, the corrupt-value / SSR guards, and throwing storage.
 */

import {
  computeFleetSummary,
  DEFAULT_FLEET_VIEW,
  FLEET_VIEW_STORAGE_KEY,
  formatCount,
  formatPercent,
  parseFleetView,
  readFleetView,
  safeRatio,
  sparklinePoints,
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

describe('formatPercent', () => {
  test('renders an en-dash for absent / non-finite values', () => {
    expect(formatPercent(undefined)).toBe('—')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(Number.NaN)).toBe('—')
  })

  test('rounds a ratio to whole percent', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.4212)).toBe('42%')
    expect(formatPercent(1)).toBe('100%')
  })
})

describe('safeRatio', () => {
  test('divides used by total', () => {
    expect(safeRatio(50, 200)).toBe(0.25)
  })

  test('guards a zero / negative / missing total', () => {
    // A host reporting no disk capacity must degrade to an en-dash, never
    // render Infinity%.
    expect(safeRatio(50, 0)).toBeUndefined()
    expect(safeRatio(50, -1)).toBeUndefined()
    expect(safeRatio(50, undefined)).toBeUndefined()
    expect(safeRatio(undefined, 200)).toBeUndefined()
  })
})

describe('computeFleetSummary', () => {
  test('counts online / offline and leaves browser hosts unknown', () => {
    // A browser-stored connection has no status probe, so it must not be
    // reported as offline (which would look like an outage).
    const summary = computeFleetSummary([
      { state: 'online', version: '24.3' },
      { state: 'offline' },
      { state: 'unknown' },
      { state: 'loading' },
    ])
    expect(summary.total).toBe(4)
    expect(summary.online).toBe(1)
    expect(summary.offline).toBe(1)
  })

  test('flags version drift only when hosts disagree', () => {
    expect(
      computeFleetSummary([
        { state: 'online', version: '24.3' },
        { state: 'online', version: '24.3' },
      ]).versionDrift
    ).toBe(false)
    const drift = computeFleetSummary([
      { state: 'online', version: '25.1' },
      { state: 'online', version: '24.3' },
    ])
    expect(drift.versionDrift).toBe(true)
    expect(drift.versions).toEqual(['24.3', '25.1'])
  })

  test('sums reported metrics and stays undefined when none reported', () => {
    // Undefined (nothing reported) must stay distinguishable from a real 0,
    // so the tile shows an en-dash rather than a misleading zero.
    const none = computeFleetSummary([{ state: 'unknown' }])
    expect(none.runningQueries).toBeUndefined()
    const some = computeFleetSummary([
      { state: 'online', runningQueries: 3, databases: 2, tables: 10 },
      { state: 'online', runningQueries: 4 },
      { state: 'offline' },
    ])
    expect(some.runningQueries).toBe(7)
    expect(some.databases).toBe(2)
    expect(some.tables).toBe(10)
  })

  test('handles an empty fleet', () => {
    const summary = computeFleetSummary([])
    expect(summary).toMatchObject({
      total: 0,
      online: 0,
      offline: 0,
      versions: [],
      versionDrift: false,
    })
  })
})

describe('sparklinePoints', () => {
  test('needs at least two finite points', () => {
    expect(sparklinePoints([], 100, 20)).toBe('')
    expect(sparklinePoints([5], 100, 20)).toBe('')
    expect(sparklinePoints([5, Number.NaN], 100, 20)).toBe('')
  })

  test('scales values across the box with y inverted', () => {
    // Lowest value sits on the baseline (y = height), highest at the top.
    expect(sparklinePoints([0, 10], 100, 20)).toBe('0.00,20.00 100.00,0.00')
  })

  test('draws a flat series as a centred line', () => {
    // A constant series has no span; collapsing it to the baseline would read
    // as "zero activity" rather than "steady activity".
    expect(sparklinePoints([7, 7, 7], 100, 20)).toBe(
      '0.00,10.00 50.00,10.00 100.00,10.00'
    )
  })
})
