/**
 * memory-pressure against a live server (opt-in, see live-clickhouse.ts).
 *
 * Pins MemoryTracking to a known number so the result exposes the
 * denominator: it must be the server's `max_server_memory_usage`, never
 * OSMemoryTotal (host RAM, which a container limit does not lower).
 */

import { builtinRule, LIVE_URL, liveClient, ruleValue } from './live-clickhouse'
import { describe, expect, test } from 'bun:test'

const TRACKING =
  "(SELECT value FROM system.metrics WHERE metric = 'MemoryTracking')"
const PINNED_BYTES = 1_000_000_000

describe.skipIf(!LIVE_URL)('memory-pressure (live)', () => {
  test('percent is MemoryTracking over max_server_memory_usage', async () => {
    const client = liveClient()!
    const rule = builtinRule('memory-pressure')
    expect(rule.sql).toContain(TRACKING)

    const rs = await client.query({
      query: `SELECT toFloat64(value) AS limit FROM system.server_settings WHERE name = 'max_server_memory_usage'`,
      format: 'JSONEachRow',
    })
    const [{ limit }] = (await rs.json()) as { limit: number }[]
    expect(limit).toBeGreaterThan(0)

    const sql = rule.sql!.replace(TRACKING, String(PINNED_BYTES))
    const value = await ruleValue(client, sql, rule.valueKey)
    expect(value).toBe(Math.round((PINNED_BYTES * 1000) / limit) / 10)
    await client.close()
  })
})
