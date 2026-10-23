/**
 * Opt-in `topContributors` for the webhook `alert` block (#4049). Each
 * supported rule maps to one bounded, read-only query. A failed or empty read
 * omits the field; it must never fail the alert.
 */

import type {
  AlertContributor,
  QueryContributor,
  TableContributor,
} from './../../adapters'

import { fetchData } from '@chm/clickhouse-client'

const LIMIT = 5
const NORMALIZED_QUERY_MAX = 200
const READ_TIMEOUT_SECONDS = 5

type Row = Record<string, unknown>
export type ContributorFetcher = (sql: string, hostId: number) => Promise<Row[]>

const SYSTEM_DATABASES = "'system', 'INFORMATION_SCHEMA', 'information_schema'"

const TABLES_BY_BYTES_SQL = `SELECT database, table, sum(bytes_on_disk) AS bytes_on_disk
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY bytes_on_disk DESC
LIMIT ${LIMIT}`

const TABLES_BY_PARTS_SQL = `SELECT database, table, count() AS active_parts
FROM system.parts
WHERE active AND database NOT IN (${SYSTEM_DATABASES})
GROUP BY database, table
ORDER BY active_parts DESC
LIMIT ${LIMIT}`

/** `queryID()` leaves out this statement, like the rules' own SQL. */
function topQueriesSql(orderBy: 'elapsed' | 'memory_usage'): string {
  return `SELECT query_id, user, round(elapsed, 1) AS elapsed_seconds, memory_usage,
  substring(normalizeQuery(query), 1, ${NORMALIZED_QUERY_MAX}) AS normalized_query
FROM system.processes
WHERE is_initial_query = 1 AND query_id != queryID()
ORDER BY ${orderBy} DESC
LIMIT ${LIMIT}`
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function tableRow(
  r: Row,
  field: 'bytesOnDisk' | 'activeParts'
): TableContributor {
  const value = num(
    r[field === 'bytesOnDisk' ? 'bytes_on_disk' : 'active_parts']
  )
  return {
    kind: 'table',
    database: String(r.database ?? ''),
    table: String(r.table ?? ''),
    [field]: value,
  }
}

function queryRow(r: Row): QueryContributor {
  return {
    kind: 'query',
    queryId: String(r.query_id ?? ''),
    user: String(r.user ?? ''),
    elapsedSeconds: num(r.elapsed_seconds),
    memoryBytes: num(r.memory_usage),
    normalizedQuery: String(r.normalized_query ?? ''),
  }
}

interface ContributorSource {
  sql: string
  map: (row: Row) => AlertContributor
}

const disk: ContributorSource = {
  sql: TABLES_BY_BYTES_SQL,
  map: (r) => tableRow(r, 'bytesOnDisk'),
}
const parts: ContributorSource = {
  sql: TABLES_BY_PARTS_SQL,
  map: (r) => tableRow(r, 'activeParts'),
}
const byMemory: ContributorSource = {
  sql: topQueriesSql('memory_usage'),
  map: queryRow,
}
const byElapsed: ContributorSource = {
  sql: topQueriesSql('elapsed'),
  map: queryRow,
}

export const CONTRIBUTOR_SOURCES: Readonly<Record<string, ContributorSource>> =
  {
    'disk-usage': disk,
    'disk-time-to-full': disk,
    'parts-pressure': parts,
    'memory-pressure': byMemory,
    'heavy-query-memory': byMemory,
    'long-running-queries': byElapsed,
  }

const defaultFetcher: ContributorFetcher = async (sql, hostId) => {
  const result = await fetchData<Row[]>({
    query: sql,
    hostId,
    format: 'JSONEachRow',
    clickhouse_settings: {
      readonly: '1',
      max_execution_time: READ_TIMEOUT_SECONDS,
    },
  })
  if (result.error) throw new Error(result.error.message)
  return Array.isArray(result.data) ? result.data : []
}

/** Top contributors for a rule, or `undefined` when unsupported, empty, or failed. */
export async function fetchTopContributors(
  ruleId: string,
  hostId: number,
  fetchRows: ContributorFetcher = defaultFetcher
): Promise<AlertContributor[] | undefined> {
  const source = CONTRIBUTOR_SOURCES[ruleId]
  if (!source) return undefined
  try {
    const rows = await fetchRows(source.sql, hostId)
    const contributors = rows.slice(0, LIMIT).map(source.map)
    return contributors.length > 0 ? contributors : undefined
  } catch {
    return undefined
  }
}
