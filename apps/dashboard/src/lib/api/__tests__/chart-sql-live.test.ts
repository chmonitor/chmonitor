/**
 * Runs every chart-registry query against a REAL ClickHouse server. Runs in
 * CI's `test-queries-config` job and self-skips everywhere else, the same way
 * `query-config/__tests__/output-columns-live.test.ts` does.
 *
 * Chart SQL (src/lib/api/charts/*.ts) had no live check, so a chart reading a
 * column the server does not have shipped green (#3769). Each chart is built
 * with its default params, its SQL variant is picked for the live version the
 * way the executor picks it, and the query runs with `FORMAT JSON`.
 *
 * A rejection fails the test, except one: an `optional` chart (or an optional
 * sub-query of a multi-query chart) whose table does not exist on this server,
 * or whose missing column it declares in `columnCheck`, which the route also
 * serves as "unavailable". Any other unknown column or function fails.
 */

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

import { beforeAll, describe, expect, it } from 'bun:test'
import {
  getClickHouseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'
import { getAvailableCharts, getChartQuery } from '@/lib/api/chart-registry'

const HOST = process.env.CLICKHOUSE_HOST ?? ''
const USER = process.env.CLICKHOUSE_USER ?? 'default'
const PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? ''

/** UNKNOWN_TABLE (60) and UNKNOWN_DATABASE (81): the table is not configured. */
const MISSING_TABLE = /\(UNKNOWN_TABLE\)|\(UNKNOWN_DATABASE\)|Code: (60|81)\./

interface LiveQuery {
  label: string
  sql: string
  params: Record<string, unknown>
  settings: Record<string, unknown>
  optional: boolean
  /** Columns the chart declares may be absent (`columnCheck`). */
  optionalColumns: string[]
}

async function getLiveVersion(): Promise<ClickHouseVersion | null> {
  if (!HOST) return null
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 3000)
    )
    return await Promise.race([getClickHouseVersion(0), timeout])
  } catch {
    return null
  }
}

function liveQueriesFor(name: string, version: ClickHouseVersion): LiveQuery[] {
  const def = getChartQuery(name)
  if (!def) throw new Error(`chart ${name} built no query`)
  if ('queries' in def) {
    return def.queries.map((q) => ({
      label: `${name}[${q.key}]`,
      sql: q.query,
      params: {},
      settings: {},
      optional: Boolean(q.optional),
      optionalColumns: [],
    }))
  }
  return [
    {
      label: name,
      sql: def.sql ? selectVersionedSql(def.sql, version) : def.query,
      params: def.queryParams ?? {},
      settings: { ...(def.clickhouseSettings ?? {}) },
      optional: Boolean(def.optional),
      optionalColumns: [def.columnCheck ?? []]
        .flat()
        .map((column) => column.split('.').pop() ?? column),
    },
  ]
}

/**
 * One-line error text. 25.8 answers a failed `FORMAT JSON` query with a JSON
 * body (`{"exception": ...}`), 26.x with plain text.
 */
function errorText(text: string): string {
  let message = text
  try {
    message = (JSON.parse(text) as { exception?: string }).exception ?? text
  } catch {
    // plain-text error body
  }
  return message.replace(/\s+/g, ' ').trim()
}

async function run(query: LiveQuery): Promise<{ ok: boolean; text: string }> {
  const url = new URL(HOST)
  url.searchParams.set('user', USER)
  if (PASSWORD) url.searchParams.set('password', PASSWORD)
  url.searchParams.set('max_result_rows', '1')
  url.searchParams.set('result_overflow_mode', 'break')
  for (const [key, value] of Object.entries(query.settings)) {
    url.searchParams.set(key, String(value))
  }
  for (const [key, value] of Object.entries(query.params)) {
    url.searchParams.set(`param_${key}`, String(value))
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      // A fresh connection per request: 25.8 closes the socket after an
      // exception and Bun would otherwise reuse it for the next query.
      headers: { Connection: 'close' },
      body: `${query.sql} FORMAT JSON`,
    })
    const text = await response.text()
    return { ok: response.ok, text: response.ok ? text : errorText(text) }
  } catch (e) {
    return { ok: false, text: `network: ${String(e)}` }
  }
}

describe('chart-registry SQL against a live ClickHouse (optional)', () => {
  let liveVersion: ClickHouseVersion | null = null

  beforeAll(async () => {
    liveVersion = await getLiveVersion()
    if (!liveVersion) {
      console.log(
        '⏭️  Skipping live chart SQL tests - ClickHouse not available (set CLICKHOUSE_HOST)'
      )
    }
  }, 10000)

  it('has a live server whenever one is supposed to be provisioned', () => {
    if (process.env.CHM_LIVE_CLICKHOUSE) expect(liveVersion).not.toBeNull()
  })

  it('runs every chart query without a server error', async () => {
    if (!liveVersion) return // Skip - no live ClickHouse
    const failed: string[] = []
    const skipped: string[] = []
    let verified = 0

    for (const name of getAvailableCharts().sort()) {
      for (const query of liveQueriesFor(name, liveVersion)) {
        const result = await run(query)
        if (result.ok) {
          verified++
          continue
        }
        const declaredMissing = query.optionalColumns.some((column) =>
          result.text.includes(`\`${column}\``)
        )
        if (
          query.optional &&
          (MISSING_TABLE.test(result.text) || declaredMissing)
        ) {
          skipped.push(query.label)
          console.log(`skip ${query.label}: ${result.text.slice(0, 160)}`)
          continue
        }
        failed.push(`${query.label}: ${result.text.slice(0, 240)}`)
      }
    }

    console.log(
      `chart SQL on ${liveVersion.raw}: ${verified} ran, ${skipped.length} skipped (optional, table or declared column missing), ${failed.length} failed`
    )
    expect(failed).toEqual([])
    expect(verified).toBeGreaterThan(0)
  }, 120000)
})
