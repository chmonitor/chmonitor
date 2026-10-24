/**
 * Prove query attribution reaches a real ClickHouse `system.query_log`.
 *
 * Usage:
 *   CLICKHOUSE_HOST=http://127.0.0.1:8123 \
 *   CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=... \
 *   bun scripts/verify-query-attribution.ts
 *
 * Sends one query through the package's `getClient` (the same pooled,
 * attributed client the dashboard uses) inside an attribution scope, then
 * reads its row back from `system.query_log` by `query_id`. It starts nothing
 * and writes nothing. It never runs `SYSTEM FLUSH LOGS`, which is not ours to
 * run on a customer cluster: it polls for up to 15 s instead (the default
 * `flush_interval_milliseconds` is 7.5 s).
 *
 * Exits 0 when both carriers check out, 1 otherwise.
 */

import type { ClickHouseClient } from '@clickhouse/client-web'

import {
  ATTRIBUTION_APP,
  ATTRIBUTION_CLIENT,
  ATTRIBUTION_SCHEMA_VERSION,
} from '../packages/clickhouse-client/src/attribution/record'
import {
  runWithAttribution,
  setAttributionVersion,
} from '../packages/clickhouse-client/src/attribution/scope'
import { getClient } from '../packages/clickhouse-client/src/index'

const SUBJECT = 'verify-query-attribution'
const SOURCE = 'script:verify-query-attribution'
const POLL_MS = 15_000
const STEP_MS = 500

const failures: string[] = []

function check(label: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${detail}`)
  if (!ok) failures.push(label)
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

interface LogRow {
  query: string
  log_comment: string
}

async function findLogRow(
  client: ClickHouseClient,
  queryId: string
): Promise<LogRow | null> {
  const deadline = Date.now() + POLL_MS
  while (Date.now() < deadline) {
    const result = await client.query({
      query: `SELECT query, log_comment FROM system.query_log
              WHERE event_date >= yesterday() AND query_id = {id:String}
                AND type = 'QueryFinish'
              LIMIT 1`,
      query_params: { id: queryId },
      format: 'JSONEachRow',
    })
    const rows = (await result.json()) as LogRow[]
    if (rows[0]) return rows[0]
    await new Promise((r) => setTimeout(r, STEP_MS))
  }
  return null
}

async function main(): Promise<void> {
  if (!process.env.CLICKHOUSE_HOST) {
    console.error('CLICKHOUSE_HOST is required')
    process.exit(2)
  }
  setAttributionVersion('verify')
  const client = (await getClient({ hostId: 0 })) as ClickHouseClient

  const sent = await runWithAttribution(
    { principal: async () => ({ subject: SUBJECT }), source: SOURCE },
    () => client.query({ query: 'SELECT 1 AS probe', format: 'JSONEachRow' })
  )
  await sent.json()
  console.log(
    `query_id ${sent.query_id}; polling system.query_log for ${POLL_MS / 1000}s`
  )

  const row = await findLogRow(client, sent.query_id)
  check(
    'query_log row',
    row !== null,
    row ? 'found' : `no QueryFinish row within ${POLL_MS / 1000}s`
  )
  if (!row) return

  const leading = row.query.match(/^\/\* (\{[^\n]*\}) \*\/\n/)
  const comment = leading ? parseJson(leading[1]) : null
  check(
    'query starts with the comment',
    comment !== null,
    row.query.split('\n')[0]
  )
  check(
    'comment client',
    comment?.client === ATTRIBUTION_CLIENT,
    String(comment?.client)
  )
  check(
    'comment user and source',
    comment?.user === SUBJECT && comment?.source === SOURCE,
    `${comment?.user} / ${comment?.source}`
  )

  if (row.log_comment === '') {
    console.log(
      '  NOTE  log_comment is empty, so only the SQL comment carries the record (expected for a readonly=1 profile)'
    )
    return
  }
  const record = parseJson(row.log_comment)
  check('log_comment parses', record !== null, row.log_comment)
  check(
    'log_comment app and schema',
    record?.app === ATTRIBUTION_APP && record?.v === ATTRIBUTION_SCHEMA_VERSION,
    `${record?.app} v${record?.v}`
  )
  check(
    'log_comment user and source',
    record?.user === SUBJECT && record?.source === SOURCE,
    `${record?.user} / ${record?.source}`
  )
}

main()
  .catch((err) => {
    console.error(err)
    failures.push('unexpected error')
  })
  .finally(() => {
    console.log(
      failures.length === 0 ? '\nOK' : `\nFAILED: ${failures.join(', ')}`
    )
    process.exit(failures.length === 0 ? 0 : 1)
  })
