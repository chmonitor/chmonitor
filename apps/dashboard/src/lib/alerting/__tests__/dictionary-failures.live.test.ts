/**
 * dictionary-failures against a live server (opt-in, see live-clickhouse.ts).
 *
 * Builds four dictionaries: one whose source is missing (FAILED), one that
 * loaded and then failed a reload (still LOADED, serving stale data), one
 * healthy, one never loaded. Only the first two may count.
 */

import { builtinRule, LIVE_URL, liveClient, ruleValue } from './live-clickhouse'
import { describe, expect, test } from 'bun:test'

const DB = 'chm_alert_dict_test'

describe.skipIf(!LIVE_URL)('dictionary-failures (live)', () => {
  test('counts a failed load and a failed reload, not a healthy or lazy one', async () => {
    const client = liveClient()!
    const rule = builtinRule('dictionary-failures')
    const run = (query: string) => client.command({ query })
    const tryRun = (query: string) => run(query).catch(() => undefined)
    const value = () => ruleValue(client, rule.sql!, rule.valueKey)
    const dict = (name: string, table: string) =>
      run(
        `CREATE DICTIONARY ${DB}.${name} (id UInt64, v String) PRIMARY KEY id SOURCE(CLICKHOUSE(DB '${DB}' TABLE '${table}')) LIFETIME(0) LAYOUT(FLAT())`
      )

    await run(`DROP DATABASE IF EXISTS ${DB} SYNC`)
    const before = await value()
    expect(before).not.toBeNull()

    await run(`CREATE DATABASE ${DB}`)
    for (const t of ['src', 'src_ok']) {
      await run(
        `CREATE TABLE ${DB}.${t} (id UInt64, v String) ENGINE = MergeTree ORDER BY id`
      )
      await run(`INSERT INTO ${DB}.${t} VALUES (1, 'a')`)
    }
    await dict('d_missing', 'nope')
    await dict('d_stale', 'src')
    await dict('d_ok', 'src_ok')
    await dict('d_lazy', 'src_ok')
    await run(`SYSTEM RELOAD DICTIONARY ${DB}.d_ok`)
    await run(`SYSTEM RELOAD DICTIONARY ${DB}.d_stale`)
    await tryRun(`SYSTEM RELOAD DICTIONARY ${DB}.d_missing`)
    await run(`DROP TABLE ${DB}.src SETTINGS check_table_dependencies = 0`)
    await tryRun(`SYSTEM RELOAD DICTIONARY ${DB}.d_stale`)

    expect(await value()).toBe(before! + 2)

    await run(`DROP DATABASE ${DB} SYNC`)
    expect(await value()).toBe(before)
    await client.close()
  }, 20_000)
})
