/**
 * Tests for the compact PeerDB KPI snapshot. Stubs window.localStorage the
 * same way fleet-helpers.test.ts does (bun test has no DOM).
 */

import {
  METRICS_CACHE_KEY_PREFIX,
  METRICS_CACHE_MAX_AGE_MS,
  metricsCacheKey,
  metricsFromSnapshot,
  parseMetricsCache,
  readMetricsCache,
  writeMetricsCache,
} from './metrics-cache'
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
  Object.defineProperty(globalThis, 'window', {
    value: undefined,
    writable: true,
    configurable: true,
  })
})

describe('metricsCacheKey', () => {
  test('env-wide vs per-connection', () => {
    expect(metricsCacheKey('')).toBe(`${METRICS_CACHE_KEY_PREFIX}:env`)
    expect(metricsCacheKey('abc')).toBe(`${METRICS_CACHE_KEY_PREFIX}:abc`)
  })
})

describe('parseMetricsCache', () => {
  test('rejects junk, missing version, and stale snapshots', () => {
    expect(parseMetricsCache(null)).toBeNull()
    expect(parseMetricsCache('not-json')).toBeNull()
    expect(
      parseMetricsCache(JSON.stringify({ v: 2, at: Date.now(), metrics: {} }))
    ).toBeNull()
    expect(
      parseMetricsCache(
        JSON.stringify({
          v: 1,
          at: Date.now() - METRICS_CACHE_MAX_AGE_MS - 1,
          metrics: {
            a: { rowsPerSec: 1, rowsSynced: 2, trend: [], lagSec: null },
          },
        })
      )
    ).toBeNull()
  })

  test('accepts a fresh v1 snapshot', () => {
    const snap = parseMetricsCache(
      JSON.stringify({
        v: 1,
        at: Date.now(),
        metrics: {
          orders_cdc: {
            rowsPerSec: 10,
            rowsSynced: 100,
            trend: [1, 2],
            lagSec: 3,
          },
        },
      })
    )
    expect(snap?.metrics.orders_cdc.rowsSynced).toBe(100)
  })
})

describe('read / write round-trip', () => {
  test('writes compact numbers and reads them back tagged as cache', () => {
    writeMetricsCache('env', {
      orders_cdc: {
        rowsPerSec: 2840,
        rowsSynced: 18_412_603,
        trend: [1, 2, 3],
        lagSec: 3.2,
        source: 'live',
      },
    })
    const snap = readMetricsCache('env')
    expect(snap?.metrics.orders_cdc.rowsSynced).toBe(18_412_603)
    const seeded = metricsFromSnapshot(snap)
    expect(seeded.orders_cdc.source).toBe('cache')
    expect(seeded.orders_cdc.rowsPerSec).toBe(2840)
  })

  test('write is a no-op when localStorage throws', () => {
    setWindowLocalStorage({
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() =>
      writeMetricsCache('env', {
        a: { rowsPerSec: 1, rowsSynced: 1, trend: [], lagSec: null },
      })
    ).not.toThrow()
    expect(readMetricsCache('env')).toBeNull()
  })
})
