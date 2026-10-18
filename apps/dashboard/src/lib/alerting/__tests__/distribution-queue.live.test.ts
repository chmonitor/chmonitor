/**
 * distribution-queue against a live server (opt-in, see live-clickhouse.ts).
 *
 * Needs a cluster whose only shard is unreachable, named by
 * `CHM_ALERT_RULES_DEAD_CLUSTER` (e.g. a `remote_servers` entry pointing at
 * 127.0.0.1:1). Async inserts into a Distributed table on it queue on disk
 * and fail to send: exactly the stuck queue the rule must count.
 */

import { builtinRule, LIVE_URL, liveClient, ruleValue } from './live-clickhouse'
import { describe, expect, test } from 'bun:test'

const CLUSTER = process.env.CHM_ALERT_RULES_DEAD_CLUSTER ?? ''
const DB = 'chm_alert_dq_test'

describe.skipIf(!LIVE_URL || !CLUSTER)('distribution-queue (live)', () => {
  test('counts a Distributed table whose sends fail, and stops when it is gone', async () => {
    const client = liveClient()!
    const rule = builtinRule('distribution-queue')
    const run = (query: string) => client.command({ query })
    const value = () => ruleValue(client, rule.sql!, rule.valueKey)

    await run(`DROP DATABASE IF EXISTS ${DB} SYNC`)
    const before = await value()
    expect(before).not.toBeNull()

    await run(`CREATE DATABASE ${DB}`)
    await run(
      `CREATE TABLE ${DB}.local (id UInt64) ENGINE = MergeTree ORDER BY id`
    )
    await run(
      `CREATE TABLE ${DB}.dist AS ${DB}.local ENGINE = Distributed(${CLUSTER}, ${DB}, local, id)`
    )
    await run(`INSERT INTO ${DB}.dist SELECT number FROM numbers(10)`)

    // The sender retries in the background; wait for the first failure.
    let stuck = before
    for (let i = 0; i < 40 && stuck === before; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      stuck = await value()
    }
    expect(stuck).toBe(before! + 1)

    await run(`DROP DATABASE ${DB} SYNC`)
    expect(await value()).toBe(before)
    await client.close()
  }, 20_000)
})
