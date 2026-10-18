/**
 * concurrent-queries against a live server (opt-in, see live-clickhouse.ts).
 *
 * Needs a server with a small `max_concurrent_queries` (4 works) and nothing
 * else running. Holds `limit - 1` slots with sleeping queries, so the rule's
 * own query takes the last one and reads 100%. On an unlimited server (0)
 * the rule must read NULL, which the sweep skips.
 */

import { classifyValue } from '../rule-registry'
import { builtinRule, LIVE_URL, liveClient, ruleValue } from './live-clickhouse'
import { describe, expect, test } from 'bun:test'

describe.skipIf(!LIVE_URL)('concurrent-queries (live)', () => {
  test('reads 100% when every slot is taken, NULL when unlimited', async () => {
    const client = liveClient()!
    const rule = builtinRule('concurrent-queries')
    const rs = await client.query({
      query: `SELECT toUInt32(value) AS limit FROM system.server_settings WHERE name = 'max_concurrent_queries'`,
      format: 'JSONEachRow',
    })
    const [{ limit }] = (await rs.json()) as { limit: number }[]

    if (limit === 0) {
      expect(await ruleValue(client, rule.sql!, rule.valueKey)).toBeNull()
    } else {
      expect(limit).toBeLessThanOrEqual(8)
      const holders = Array.from({ length: limit - 1 }, () =>
        liveClient()!.command({ query: 'SELECT sleep(2) FORMAT Null' })
      )
      await new Promise((resolve) => setTimeout(resolve, 700))
      const value = await ruleValue(client, rule.sql!, rule.valueKey)
      await Promise.all(holders)
      expect(value).toBe(100)
      expect(classifyValue(value, rule.defaults)).toBe('critical')
    }
    await client.close()
  }, 15_000)
})
