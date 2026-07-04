/**
 * Tests for dashboard-query-kv-cache.ts (L2 KV cache for the dashboard-query
 * allowlist, #2185).
 *
 * Core invariant: `getKVCachedDashboardQueries` must return `null` — never
 * throw, never return an empty/allow-everything value — on any miss, read
 * error, or absent binding, so callers always fall back to the authoritative
 * ClickHouse check (fail-closed).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('@chm/logger', () => ({
  error: () => {},
  warn: () => {},
  debug: () => {},
}))

import {
  getKVCachedDashboardQueries,
  setKVCachedDashboardQueries,
} from './dashboard-query-kv-cache'

interface FakeKV {
  get: (key: string, opts?: unknown) => Promise<unknown>
  put: (key: string, value: string, opts?: unknown) => Promise<void>
}

function installKV(kv: FakeKV) {
  ;(
    globalThis as unknown as { CHM_DASHBOARD_QUERY_KV: FakeKV }
  ).CHM_DASHBOARD_QUERY_KV = kv
}

function removeKV() {
  delete (globalThis as unknown as { CHM_DASHBOARD_QUERY_KV?: FakeKV })
    .CHM_DASHBOARD_QUERY_KV
}

beforeEach(() => {
  removeKV()
})

afterEach(() => {
  removeKV()
})

describe('getKVCachedDashboardQueries', () => {
  test('returns null when no KV binding is present (self-hosted/Node)', async () => {
    const result = await getKVCachedDashboardQueries(0)
    expect(result).toBeNull()
  })

  test('returns null on a KV miss (get resolves null)', async () => {
    installKV({ get: async () => null, put: async () => {} })
    const result = await getKVCachedDashboardQueries(0)
    expect(result).toBeNull()
  })

  test('returns null when the KV get() call throws (fail-closed)', async () => {
    installKV({
      get: async () => {
        throw new Error('boom')
      },
      put: async () => {},
    })
    const result = await getKVCachedDashboardQueries(0)
    expect(result).toBeNull()
  })

  test('returns null for a malformed (non-array) cached value', async () => {
    installKV({ get: async () => ({ not: 'an array' }), put: async () => {} })
    const result = await getKVCachedDashboardQueries(0)
    expect(result).toBeNull()
  })

  test('returns a Set of queries on a well-formed hit', async () => {
    installKV({
      get: async () => ['SELECT 1', 'SELECT 2'],
      put: async () => {},
    })
    const result = await getKVCachedDashboardQueries(0)
    expect(result).toEqual(new Set(['SELECT 1', 'SELECT 2']))
  })

  test('uses a per-host cache key', async () => {
    const seenKeys: string[] = []
    installKV({
      get: async (key: string) => {
        seenKeys.push(key)
        return null
      },
      put: async () => {},
    })
    await getKVCachedDashboardQueries(5)
    expect(seenKeys).toEqual(['dashboard-queries:5'])
  })
})

describe('setKVCachedDashboardQueries', () => {
  test('is a no-op when no KV binding is present', async () => {
    // Must not throw even though there is no binding to write to.
    await expect(
      setKVCachedDashboardQueries(0, new Set(['q']))
    ).resolves.toBeUndefined()
  })

  test('writes the serialized query set with an expirationTtl', async () => {
    let putArgs: [string, string, unknown] | undefined
    installKV({
      get: async () => null,
      put: async (key: string, value: string, opts?: unknown) => {
        putArgs = [key, value, opts]
      },
    })

    await setKVCachedDashboardQueries(3, new Set(['SELECT 1']))

    expect(putArgs).toBeDefined()
    expect(putArgs![0]).toBe('dashboard-queries:3')
    expect(JSON.parse(putArgs![1])).toEqual(['SELECT 1'])
    expect(
      (putArgs![2] as { expirationTtl: number }).expirationTtl
    ).toBeGreaterThan(0)
  })

  test('swallows a KV put() error without throwing', async () => {
    installKV({
      get: async () => null,
      put: async () => {
        throw new Error('write failed')
      },
    })

    await expect(
      setKVCachedDashboardQueries(0, new Set(['q']))
    ).resolves.toBeUndefined()
  })
})
