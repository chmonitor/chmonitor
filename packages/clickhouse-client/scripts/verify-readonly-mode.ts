/**
 * Live reproduction of issue #3680 against a real ClickHouse server.
 *
 * Usage:
 *   CLICKHOUSE_HOST=http://127.0.0.1:8123 \
 *   CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=... \
 *   bun scripts/verify-readonly-mode.ts
 *
 * chmonitor carries `max_execution_time` on every request, and several call
 * sites additionally ask for read-only. This sends both shapes against the
 * server — first at read-only level 1 (the reported failure) then at level 2
 * (what the client now sends) — and asserts read-only mode still blocks
 * writes and DDL at level 2.
 *
 * Needs a reachable server: it creates and drops one `readonly_probe` table.
 */

import { createClient } from '@clickhouse/client-web'

import { withReadonlyEnforcement } from '../src/clickhouse/readonly-settings'

const host = process.env.CLICKHOUSE_HOST ?? 'http://127.0.0.1:8123'
const user = process.env.CLICKHOUSE_USER ?? 'default'
const password = process.env.CLICKHOUSE_PASSWORD ?? ''

/** From CLICKHOUSE_MAX_EXECUTION_TIME; the client's default. */
const MAX_EXECUTION_TIME = 60

/**
 * The per-query value the SQL asks for — the 25 the hard-coded
 * `SETTINGS max_execution_time = 25` clauses use (query-charts.ts,
 * shape-mining.ts, ttl-partition-sql.ts). Deliberately different from
 * {@link MAX_EXECUTION_TIME}.
 */
const CLAUSE_EXECUTION_TIME = 25

const failures: string[] = []

function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
  if (!ok) failures.push(label)
}

/**
 * Read the ClickHouse error code and message off a rejection. The JS client
 * raises its own `ClickHouseError`, which exposes `code` and `message`; fall
 * back to parsing the text so this also works for a plain Error.
 */
function parseError(err: unknown): { code: number; message: string } {
  const text = String(err)
  const code = Number(
    (err as { code?: number })?.code ?? /Code:\s*(\d+)/.exec(text)?.[1] ?? 0
  )
  const message =
    (err as { message?: string })?.message ?? text.trim().split('\n')[0]
  return { code, message }
}

async function main(): Promise<void> {
  const client = createClient({
    url: host,
    username: user,
    password,
    clickhouse_settings: { max_execution_time: MAX_EXECUTION_TIME },
  })

  const version = await (
    await client.query({ query: 'SELECT version()', format: 'JSONEachRow' })
  ).text()
  console.log(`ClickHouse: ${version.trim()}\n`)

  /**
   * One read, exactly as the dashboard sends it: the client's
   * `max_execution_time` plus a per-query `SETTINGS max_execution_time`
   * clause, under the requested read-only level. The SETTINGS clause is the
   * channel that failed — a query-level change is exactly what level 1 forbids.
   */
  // The clause value must DIFFER from the client-level `max_execution_time`:
  // re-setting a setting to the value it already holds is a no-op the server
  // allows, so only a genuine change trips Code 164. That is exactly the
  // reported case — the client sends 60, the TTL check's SQL asks for 25.
  const readOnlyRead = (readonly: '1' | '2') =>
    client.query({
      query: `SELECT 1 AS c SETTINGS max_execution_time = ${CLAUSE_EXECUTION_TIME}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly },
    })

  console.log('BEFORE — read-only level 1, what chmonitor sent')
  try {
    await readOnlyRead('1')
    check(
      'level 1 + per-query setting fails',
      false,
      'unexpectedly SUCCEEDED — is this server version different?'
    )
  } catch (err) {
    const { code, message } = parseError(err)
    check(
      'level 1 + per-query setting fails',
      code === 164,
      `Code: ${code} ${message}`
    )
  }

  const fixed = withReadonlyEnforcement(client)

  console.log('\nAFTER — the client as fixed (level 1 in, level 2 on the wire)')
  const body = await (
    await fixed.query({
      query: `SELECT 1 AS c SETTINGS max_execution_time = ${CLAUSE_EXECUTION_TIME}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: '1' },
    })
  ).text()
  check('read-only read runs', body.includes('"c"'), body.trim())

  // Read-only must still block writes and DDL — the point of the setting.
  console.log('\nRead-only mode still blocks writes and DDL')
  // Seeded unwrapped, so the read-only runs below hit a statement that would
  // otherwise succeed. Without it DROP/ALTER fail on "no such table" (Code 60)
  // and prove nothing about read-only.
  await client.command({
    query: 'CREATE TABLE IF NOT EXISTS readonly_probe (x UInt8) ENGINE=Memory',
  })

  const blocked: Array<[string, string]> = [
    ['INSERT', 'INSERT INTO readonly_probe VALUES (1)'],
    ['CREATE TABLE', 'CREATE TABLE readonly_probe_2 (x UInt8) ENGINE=Memory'],
    ['ALTER', 'ALTER TABLE readonly_probe DELETE WHERE 1'],
    ['DROP TABLE', 'DROP TABLE readonly_probe'],
    ['CREATE DATABASE', 'CREATE DATABASE readonly_probe'],
  ]
  for (const [label, sql] of blocked) {
    try {
      await fixed.command({
        query: sql,
        clickhouse_settings: { readonly: '1' },
      })
      check(`${label} blocked`, false, 'unexpectedly SUCCEEDED')
    } catch (err) {
      const { code, message } = parseError(err)
      check(`${label} blocked`, code === 164, `Code: ${code} ${message}`)
    }
  }

  // Level 2 must not let a query turn read-only OFF.
  try {
    await fixed.query({
      query: 'SELECT 1 SETTINGS readonly = 0',
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: '1' },
    })
    check('readonly cannot be disabled', false, 'unexpectedly SUCCEEDED')
  } catch (err) {
    const { code, message } = parseError(err)
    check(
      'readonly cannot be disabled',
      code === 164,
      `Code: ${code} ${message}`
    )
  }

  // The read-only DROP above is *meant* to fail, so the probe table survives.
  // Drop it unwrapped, then clean up anything a partially-failed run created.
  await client.command({
    query: 'DROP TABLE IF EXISTS readonly_probe',
  })
  await client.command({ query: 'DROP TABLE IF EXISTS readonly_probe_2' })
  await client.command({ query: 'DROP DATABASE IF EXISTS readonly_probe' })

  await client.close()

  console.log(
    failures.length === 0
      ? '\nAll checks passed.'
      : `\n${failures.length} check(s) failed: ${failures.join(', ')}`
  )
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
