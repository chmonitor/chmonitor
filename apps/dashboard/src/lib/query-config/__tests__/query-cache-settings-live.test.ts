/**
 * Live integration test for the query-cache settings (#2182) against a REAL
 * ClickHouse server. Runs in CI's `test-queries-config` job (live ClickHouse
 * service container, `CLICKHOUSE_HOST` set workflow-wide) and self-skips
 * everywhere else.
 *
 * Regression context: a bare `overflow_mode: 'throw'` was once added to
 * `buildQueryCacheSettings` — a setting name that does not exist in ANY
 * ClickHouse version — which failed every cache-enabled query with
 * "Setting overflow_mode is neither a builtin setting nor started with the
 * prefix 'SQL_'". Unit tests with mocked versions can't catch a hallucinated
 * setting name; only a real server can. This test:
 *
 * 1. Asserts every setting name emitted for the live server's version exists
 *    in that server's `system.settings` (catches unknown-setting names).
 * 2. Executes a real `system.*` query with the settings applied (catches
 *    interaction failures like error 719 QUERY_CACHE_USED_WITH_SYSTEM_TABLE
 *    or 731 QUERY_CACHE_USED_WITH_NON_THROW_OVERFLOW_MODE).
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import { fetchData } from '@chm/clickhouse-client'
import { parseVersion } from '@chm/clickhouse-client/clickhouse-version'
import { buildQueryCacheSettings } from '@/lib/api/query-cache-settings'

async function getLiveVersion(): Promise<string | null> {
  if (!process.env.CLICKHOUSE_HOST) return null
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 3000)
    )
    const result = await Promise.race([
      fetchData<{ v: string }[]>({
        query: 'SELECT version() AS v',
        hostId: 0,
        format: 'JSONEachRow',
      }),
      timeout,
    ])
    if (result.error || !Array.isArray(result.data) || !result.data[0]?.v) {
      return null
    }
    return result.data[0].v
  } catch {
    return null
  }
}

describe('query-cache settings against a live ClickHouse (optional)', () => {
  let rawVersion: string | null = null

  beforeAll(async () => {
    rawVersion = await getLiveVersion()
    if (!rawVersion) {
      console.log(
        '⏭️  Skipping live query-cache tests - ClickHouse not available (set CLICKHOUSE_HOST)'
      )
    }
  }, 10000)

  it('emits only setting names the live server recognizes', async () => {
    if (!rawVersion) return // Skip - no live ClickHouse

    const settings = buildQueryCacheSettings({
      version: parseVersion(rawVersion),
      ttlSeconds: 30,
    })
    const names = Object.keys(settings)
    // On >=23.5 servers (all CI containers) the cache must actually engage.
    expect(names.length).toBeGreaterThan(0)

    const inList = names.map((n) => `'${n}'`).join(', ')
    const result = await fetchData<{ name: string }[]>({
      query: `SELECT name FROM system.settings WHERE name IN (${inList})`,
      hostId: 0,
      format: 'JSONEachRow',
    })
    expect(result.error).toBeUndefined()
    const known = new Set(
      (Array.isArray(result.data) ? result.data : []).map((r) => r.name)
    )
    for (const name of names) {
      // A name missing from system.settings would fail EVERY cache-enabled
      // query on this server with an unknown-setting error.
      expect(known.has(name)).toBe(true)
    }
  })

  it('executes a system.* query successfully with the cache settings applied', async () => {
    if (!rawVersion) return // Skip - no live ClickHouse

    const settings = buildQueryCacheSettings({
      version: parseVersion(rawVersion),
      ttlSeconds: 30,
    })

    // system.* is what every dashboard poll reads; this exercises the
    // unknown-setting, 719 (system table), and 731 (overflow mode) failure
    // modes end-to-end on whatever version the CI container runs.
    const result = await fetchData<{ c: string }[]>({
      query: 'SELECT count() AS c FROM system.metrics',
      hostId: 0,
      format: 'JSONEachRow',
      clickhouse_settings: settings,
    })
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.data)).toBe(true)
  })
})
