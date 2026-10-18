/**
 * Shared plumbing for the live query-config tests: reach the CI ClickHouse
 * service over raw HTTP and classify the errors it returns.
 */

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import type { QueryConfig } from '../../../types/query-config'

import { getClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

const HOST = process.env.CLICKHOUSE_HOST ?? ''
const USER = process.env.CLICKHOUSE_USER ?? 'default'
const PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? ''

export async function getLiveVersion(): Promise<ClickHouseVersion | null> {
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

export interface LiveResponse {
  ok: boolean
  body: unknown
  text: string
}

/**
 * POST `query` with the config's own `clickhouseSettings` (stack-traces needs
 * allow_introspection_functions) and `defaultParams`, plus `settings`. Status
 * and raw text come back so a caller can assert on an ERROR rather than skip
 * past it.
 */
export async function postToLiveServer(
  query: string,
  config: QueryConfig,
  settings: Record<string, string | number>
): Promise<LiveResponse> {
  const url = new URL(HOST)
  url.searchParams.set('user', USER)
  if (PASSWORD) url.searchParams.set('password', PASSWORD)
  for (const [key, value] of Object.entries({
    ...config.clickhouseSettings,
    ...settings,
  })) {
    url.searchParams.set(key, String(value))
  }
  for (const [key, value] of Object.entries(config.defaultParams ?? {})) {
    url.searchParams.set(`param_${key}`, String(value))
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      // A fresh connection per request. ClickHouse 25.8 answers an exception
      // with `Connection: Close`, but Bun still reuses the pooled socket, so
      // the NEXT config fails with "socket connection was closed" (that is how
      // `merges` failed on 25.8 after `query-metric-log` was rejected).
      headers: { Connection: 'close' },
      body: query,
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { ok: response.ok, body, text }
  } catch (e) {
    return { ok: false, body: null, text: `network: ${String(e)}` }
  }
}

/** UNKNOWN_TABLE, UNKNOWN_DATABASE: the server lacks the table, the SQL may be fine. */
const MISSING_TABLE_CODES = new Set([60, 81])

/**
 * Errors that say the server is not set up for this query, not that the SQL is
 * wrong: NO_ELEMENTS_IN_CONFIG (no ZooKeeper section), NO_ZOOKEEPER,
 * KEEPER_EXCEPTION, and UNKNOWN_QUERY_PARAMETER (a parameter the page fills in
 * and the config has no default for).
 */
const ENVIRONMENT_CODES = new Set([139, 225, 999, 456])

export type Rejection =
  | { kind: 'skip'; reason: string }
  | { kind: 'fail'; reason: string }

/**
 * Classify a query the live server REJECTED. A missing table on a config that
 * declares it optional, or an ENVIRONMENT_CODES error, is a skip; every other
 * error (unknown column or function, type mismatch, bad aggregation, no code at
 * all) is a defect in the shipped SQL. #3851: `scheduler` read a column 25.8
 * does not have, the old check skipped every non-ILLEGAL_AGGREGATION error, and
 * CI stayed green.
 */
export function classifyRejection(
  config: QueryConfig,
  text: string
): Rejection {
  const reason = `${config.name}: ${text.split('\n')[0].slice(0, 200)}`
  const code = Number(/Code: (\d+)/.exec(text)?.[1])
  const declaresOptional = Boolean(config.optional || config.tableCheck)
  if (
    ENVIRONMENT_CODES.has(code) ||
    (MISSING_TABLE_CODES.has(code) && declaresOptional)
  ) {
    return { kind: 'skip', reason }
  }
  return { kind: 'fail', reason }
}
