/**
 * Tests for buildQueryCacheSettings (#2182) — the ClickHouse query-cache
 * opt-in for read-only polling paths (charts/tables/menu-counts/host-status).
 *
 * These pin down the version-gating safety net: an unrecognized ClickHouse
 * setting name fails the ENTIRE query, so getting the cutoffs wrong would be
 * far worse than the staleness this feature accepts. See query-cache-settings.ts
 * for the version history this encodes.
 */

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

import { describe, expect, test } from 'bun:test'
import { buildQueryCacheSettings } from '@/lib/api/query-cache-settings'

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
})
