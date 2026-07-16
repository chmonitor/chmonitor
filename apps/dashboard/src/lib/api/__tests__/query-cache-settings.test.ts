/**
 * Tests for buildQueryCacheSettings (#2182) — the ClickHouse query-cache
 * opt-in for read-only polling paths (charts/tables/menu-counts/host-status).
 *
 * These pin down the version-gating safety net: an unrecognized ClickHouse
 * setting name fails the ENTIRE query, so getting the cutoffs wrong would be
 * far worse than the staleness this feature accepts. See query-cache-settings.ts
 * for the version history this encodes.
 */

import type { ClickHouseSettings } from '@clickhouse/client'

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  buildQueryCacheSettings,
  clearUnknownSettingRejections,
  isUnknownSettingError,
  runWithQueryCache,
  withUnknownSettingRetry,
} from '@/lib/api/query-cache-settings'

function version(major: number, minor: number, patch = 0): ClickHouseVersion {
  return { major, minor, patch, raw: `${major}.${minor}.${patch}` }
}

describe('buildQueryCacheSettings', () => {
  test('returns {} when disabled', () => {
    expect(
      buildQueryCacheSettings({
        version: version(24, 8),
        ttlSeconds: 30,
        disabled: true,
      })
    ).toEqual({})
  })

  test('returns {} when ttlSeconds is non-positive', () => {
    expect(
      buildQueryCacheSettings({ version: version(24, 8), ttlSeconds: 0 })
    ).toEqual({})
    expect(
      buildQueryCacheSettings({ version: version(24, 8), ttlSeconds: -5 })
    ).toEqual({})
  })

  test('fails closed when the ClickHouse version is unknown', () => {
    // A version lookup failure must never silently enable use_query_cache —
    // an undetectable version might predate 23.5 (query cache introduction),
    // and sending an unknown setting name errors the whole query.
    expect(buildQueryCacheSettings({ version: null, ttlSeconds: 30 })).toEqual(
      {}
    )
  })

  test('fails closed on ClickHouse versions before 23.5 (no query cache)', () => {
    expect(
      buildQueryCacheSettings({ version: version(23, 3), ttlSeconds: 30 })
    ).toEqual({})
    expect(
      buildQueryCacheSettings({ version: version(19, 1), ttlSeconds: 30 })
    ).toEqual({})
  })

  test('uses the boolean nondeterministic setting on 23.5–24.1', () => {
    const settings = buildQueryCacheSettings({
      version: version(23, 5),
      ttlSeconds: 45,
    })
    expect(settings.use_query_cache).toBe(1)
    expect(settings.query_cache_ttl).toBe(45)
    expect(
      settings.query_cache_store_results_of_queries_with_nondeterministic_functions
    ).toBe(1)
    expect(
      settings.query_cache_nondeterministic_function_handling
    ).toBeUndefined()

    const settings2413 = buildQueryCacheSettings({
      version: version(24, 1, 9),
      ttlSeconds: 45,
    })
    expect(
      settings2413.query_cache_store_results_of_queries_with_nondeterministic_functions
    ).toBe(1)
  })

  test("uses query_cache_nondeterministic_function_handling: 'save' from 24.2 onward", () => {
    const settings = buildQueryCacheSettings({
      version: version(24, 2),
      ttlSeconds: 60,
    })
    expect(settings.use_query_cache).toBe(1)
    expect(settings.query_cache_ttl).toBe(60)
    expect(settings.query_cache_nondeterministic_function_handling).toBe('save')
    expect(
      settings.query_cache_store_results_of_queries_with_nondeterministic_functions
    ).toBeUndefined()

    const settingsNewer = buildQueryCacheSettings({
      version: version(25, 1),
      ttlSeconds: 10,
    })
    expect(settingsNewer.query_cache_nondeterministic_function_handling).toBe(
      'save'
    )
  })

  test('omits query_cache_system_table_handling before 24.4', () => {
    // The setting does not exist before 24.4; sending it would fail the query
    // with "Unknown setting". Pre-24.4 hosts skip caching system-table queries
    // without throwing, so leaving it unset is safe.
    for (const v of [version(23, 5), version(24, 2), version(24, 3, 9)]) {
      const settings = buildQueryCacheSettings({ version: v, ttlSeconds: 30 })
      expect(settings.query_cache_system_table_handling).toBeUndefined()
    }
  })

  test("sets query_cache_system_table_handling: 'save' from 24.4 onward", () => {
    // Regression: without this, `use_query_cache=1` on any system.* query
    // (e.g. the Running Queries page's system.processes scan) throws error 719
    // QUERY_CACHE_USED_WITH_SYSTEM_TABLE on ClickHouse 24.4+ — the query
    // returned zero rows on ClickHouse 26.3 for exactly this reason.
    for (const v of [version(24, 4), version(24, 8), version(26, 3, 9)]) {
      const settings = buildQueryCacheSettings({ version: v, ttlSeconds: 30 })
      expect(settings.use_query_cache).toBe(1)
      expect(settings.query_cache_system_table_handling).toBe('save')
    }
  })

  test('emits only real ClickHouse setting names, on every version', () => {
    // Regression guard for the removed bare `overflow_mode` — see the NOTE in
    // query-cache-settings.ts. The live counterpart (query-cache-settings-live
    // .test.ts) checks these names against a real server's system.settings.
    const KNOWN_SETTINGS = new Set([
      'use_query_cache',
      'query_cache_ttl',
      'query_cache_nondeterministic_function_handling',
      'query_cache_store_results_of_queries_with_nondeterministic_functions',
      'query_cache_system_table_handling',
    ])
    for (const v of [
      version(23, 5),
      version(24, 1),
      version(24, 2),
      version(24, 4),
      version(25, 1),
      version(26, 3),
      version(99, 9),
    ]) {
      const settings = buildQueryCacheSettings({ version: v, ttlSeconds: 30 })
      expect(Object.keys(settings).every((k) => KNOWN_SETTINGS.has(k))).toBe(
        true
      )
    }
  })
})

describe('isUnknownSettingError', () => {
  test('matches both UNKNOWN_SETTING message wordings and code 115', () => {
    expect(
      isUnknownSettingError(
        new Error(
          "Setting overflow_mode is neither a builtin setting nor started with the prefix 'SQL_' registered for user-defined settings"
        )
      )
    ).toBe(true)
    expect(
      isUnknownSettingError({ message: "Unknown setting 'use_query_cache'" })
    ).toBe(true)
    expect(
      isUnknownSettingError({ message: 'Code: 115. DB::Exception: something' })
    ).toBe(true)
  })

  test('does not match unrelated errors', () => {
    expect(isUnknownSettingError(new Error('Connection refused'))).toBe(false)
    expect(isUnknownSettingError({ message: 'Code: 719. system table' })).toBe(
      false
    )
    expect(isUnknownSettingError(undefined)).toBe(false)
    expect(isUnknownSettingError(null)).toBe(false)
  })
})

describe('withUnknownSettingRetry', () => {
  const cacheSettings: ClickHouseSettings = {
    use_query_cache: 1,
    query_cache_ttl: 30,
  }
  const unknownSettingError = {
    type: 'query_error',
    message:
      "Setting use_query_cache is neither a builtin setting nor started with the prefix 'SQL_' registered for user-defined settings",
  }

  beforeEach(() => {
    clearUnknownSettingRejections()
  })

  test('passes settings through on success (no retry)', async () => {
    const calls: ClickHouseSettings[] = []
    const result = await withUnknownSettingRetry(
      cacheSettings,
      async (settings) => {
        calls.push(settings)
        return { data: [1] }
      }
    )
    expect(result).toEqual({ data: [1] })
    expect(calls).toEqual([cacheSettings])
  })

  test('retries without settings when the result carries an unknown-setting error', async () => {
    const calls: ClickHouseSettings[] = []
    const result = await withUnknownSettingRetry(
      cacheSettings,
      async (settings) => {
        calls.push(settings)
        return Object.keys(settings).length > 0
          ? { data: null as number[] | null, error: unknownSettingError }
          : { data: [1] as number[] | null, error: undefined }
      }
    )
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual([1])
    expect(calls).toEqual([cacheSettings, {}])
  })

  test('retries without settings when the query throws an unknown-setting error', async () => {
    const calls: ClickHouseSettings[] = []
    const result = await withUnknownSettingRetry(
      cacheSettings,
      async (settings) => {
        calls.push(settings)
        if (Object.keys(settings).length > 0) {
          throw new Error(unknownSettingError.message)
        }
        return 'ok'
      }
    )
    expect(result).toBe('ok')
    expect(calls).toEqual([cacheSettings, {}])
  })

  test('does not retry on unrelated errors (returned or thrown)', async () => {
    let runs = 0
    const result = await withUnknownSettingRetry(cacheSettings, async () => {
      runs++
      return { error: { type: 'network_error', message: 'timeout' } }
    })
    expect(runs).toBe(1)
    expect(result.error?.type).toBe('network_error')

    await expect(
      withUnknownSettingRetry(cacheSettings, async () => {
        throw new Error('Connection refused')
      })
    ).rejects.toThrow('Connection refused')
  })

  test('skips the fallback machinery entirely when settings are empty', async () => {
    let runs = 0
    await withUnknownSettingRetry({}, async () => {
      runs++
      return { error: unknownSettingError }
    })
    // An unknown-setting error WITHOUT cache settings can't be caused by us —
    // never retried, surfaced as-is.
    expect(runs).toBe(1)
  })

  test('remembers the rejection per host and skips settings on later calls', async () => {
    const calls: ClickHouseSettings[] = []
    const run = async (settings: ClickHouseSettings) => {
      calls.push(settings)
      return Object.keys(settings).length > 0
        ? { error: unknownSettingError }
        : { error: undefined }
    }
    // First call: attempt + retry (2 executions).
    await withUnknownSettingRetry(cacheSettings, run, 7)
    // Second call on the SAME host: goes straight to no-settings (1 execution)
    // instead of paying the failed round-trip on every poll.
    await withUnknownSettingRetry(cacheSettings, run, 7)
    expect(calls).toEqual([cacheSettings, {}, {}])

    // A DIFFERENT host is unaffected by host 7's rejection memo.
    await withUnknownSettingRetry(cacheSettings, run, 8)
    expect(calls.at(-2)).toEqual(cacheSettings)
    expect(calls.at(-1)).toEqual({})
  })
})

describe('runWithQueryCache', () => {
  beforeEach(() => {
    clearUnknownSettingRejections()
  })

  test('builds version-gated settings and runs under the safety net in one step', async () => {
    const calls: ClickHouseSettings[] = []
    await runWithQueryCache(
      { version: version(24, 8), ttlSeconds: 30, hostId: 0 },
      async (settings) => {
        calls.push(settings)
        return { data: [] }
      }
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].use_query_cache).toBe(1)
    expect(calls[0].query_cache_ttl).toBe(30)
  })

  test('passes {} straight through for unsupported versions', async () => {
    const calls: ClickHouseSettings[] = []
    await runWithQueryCache(
      { version: null, ttlSeconds: 30, hostId: 0 },
      async (settings) => {
        calls.push(settings)
        return { data: [] }
      }
    )
    expect(calls).toEqual([{}])
  })
})
