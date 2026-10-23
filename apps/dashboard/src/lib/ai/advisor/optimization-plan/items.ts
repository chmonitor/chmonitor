/**
 * Map persisted advisor findings to plan candidates. Pure, no I/O.
 *
 * Each finding row carries one scalar `value` whose meaning depends on the
 * metric (bytes for usage, a ratio for TTL rewrite, counts elsewhere). Only
 * byte values become `savedBytes`; everything else stays null.
 *
 * Earlier maintainer decisions bind these builders: usage findings are "this
 * replica only, unread is not unused" and never say safe to drop; detached
 * parts are review-only and never get a DROP or ATTACH statement.
 */

import type { FindingRow } from '@/lib/findings/findings-store'
import type { ApplyCost, PlanCandidate, PlanSource } from './schema'

import { estimateHours } from './ranker'
import { quoteIdent } from '@/lib/api/shared/sql-identifier'

const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Split `db.table[.name]` only when every part is a plain identifier. */
export function parseQualified(fq: string, parts: 2 | 3): string[] | null {
  const split = fq.split('.')
  if (split.length !== parts) return null
  return split.every((p) => PLAIN_IDENT.test(p)) ? split : null
}

export function sqlString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const NO_COST: ApplyCost = {
  kind: 'none',
  rewriteBytes: null,
  freeDiskNeeded: null,
  estHours: null,
}

const READ_WINDOW = 'event_date >= today() - 30'

function base(
  row: FindingRow,
  id: string,
  source: PlanSource
): Pick<
  PlanCandidate,
  | 'id'
  | 'source'
  | 'evidence'
  | 'dependsOn'
  | 'readBytesSavedPerDay'
  | 'reversible'
> {
  return {
    id,
    source,
    evidence: row.detail || row.title,
    dependsOn: [],
    readBytesSavedPerDay: null,
    reversible: true,
  }
}

function tableFilter(db: string, table: string, col = 'table'): string {
  return `database = ${sqlString(db)} AND ${col} = ${sqlString(table)}`
}

function unusedProjection(row: FindingRow, fq: string): PlanCandidate {
  const parts = parseQualified(fq, 3)
  const common = {
    ...base(row, `usage:unused_projection:${fq}`, 'usage'),
    savedBytes: row.value > 0 ? row.value : null,
    risk: 'high' as const,
    reversible: false,
    needsOwnerApproval: true,
  }
  if (!parts) {
    return {
      ...common,
      title: `Ask the owner about unused projection ${fq}`,
      owner: null,
      applyCost: NO_COST,
      ddl: [],
      verifySql: '',
      evidenceSql: '',
    }
  }
  const [db, table, name] = parts
  return {
    ...common,
    title: `Drop unused projection ${name} on ${db}.${table}`,
    owner: db,
    // Dropping a projection removes its files; no row data is rewritten.
    applyCost: {
      kind: 'mutation',
      rewriteBytes: 0,
      freeDiskNeeded: 0,
      estHours: 0,
    },
    ddl: [
      `ALTER TABLE ${quoteIdent(db)}.${quoteIdent(table)} DROP PROJECTION ${quoteIdent(name)}`,
    ],
    verifySql: `SELECT count() AS active_projection_parts FROM system.projection_parts WHERE ${tableFilter(db, table)} AND name = ${sqlString(name)} AND active`,
    evidenceSql: `SELECT count() AS selects_using_projection FROM system.query_log WHERE type = 'QueryFinish' AND query_kind = 'Select' AND ${READ_WINDOW} AND has(arrayMap(x -> replaceAll(x, '\`', ''), projections), ${sqlString(fq)})`,
  }
}

function unreadTable(row: FindingRow, fq: string): PlanCandidate {
  const parts = parseQualified(fq, 2)
  const evidenceSql = parts
    ? `SELECT count() AS selects_reading_table FROM system.query_log WHERE type = 'QueryFinish' AND query_kind = 'Select' AND ${READ_WINDOW} AND has(tables, ${sqlString(fq)})`
    : ''
  return {
    ...base(row, `usage:unread_table:${fq}`, 'usage'),
    title: `Ask the owner whether ${fq} is still needed`,
    owner: parts?.[0] ?? null,
    savedBytes: row.value > 0 ? row.value : null,
    applyCost: NO_COST,
    risk: 'high',
    reversible: false,
    // Unread is not unused: the plan names the question, never a DROP TABLE.
    ddl: [],
    verifySql: evidenceSql,
    evidenceSql,
    needsOwnerApproval: true,
  }
}

function ttlRewrite(row: FindingRow, fq: string): PlanCandidate {
  const parts = parseQualified(fq, 2)
  const common = {
    ...base(row, `ttl_rewrite:${fq}`, 'ttl'),
    title: `Enable ttl_only_drop_parts on ${fq}`,
    owner: parts?.[0] ?? null,
    savedBytes: null,
    risk: 'medium' as const,
    needsOwnerApproval: false,
  }
  if (!parts) {
    return {
      ...common,
      applyCost: NO_COST,
      ddl: [],
      verifySql: '',
      evidenceSql: '',
    }
  }
  const [db, table] = parts
  const target = `${quoteIdent(db)}.${quoteIdent(table)}`
  return {
    ...common,
    applyCost: {
      kind: 'metadata',
      rewriteBytes: 0,
      freeDiskNeeded: 0,
      estHours: 0,
    },
    ddl: [`ALTER TABLE ${target} MODIFY SETTING ttl_only_drop_parts = 1`],
    rollbackSql: `ALTER TABLE ${target} RESET SETTING ttl_only_drop_parts`,
    verifySql: `SELECT engine_full LIKE '%ttl_only_drop_parts = 1%' AS enabled FROM system.tables WHERE database = ${sqlString(db)} AND name = ${sqlString(table)}`,
    evidenceSql: `SELECT sum(read_bytes) AS ttl_read_bytes FROM system.part_log WHERE event_type = 'MergeParts' AND merge_reason = 'TTLDeleteMerge' AND event_date >= today() - 7 AND ${tableFilter(db, table)}`,
  }
}

function reviewItem(
  row: FindingRow,
  id: string,
  source: PlanSource,
  title: string,
  fq: string | null,
  evidenceSql: (db: string, table: string) => string
): PlanCandidate {
  const parts = fq ? parseQualified(fq, 2) : null
  const sql = parts ? evidenceSql(parts[0], parts[1]) : ''
  return {
    ...base(row, id, source),
    title,
    owner: parts?.[0] ?? null,
    savedBytes: null,
    applyCost: NO_COST,
    risk: 'low',
    ddl: [],
    verifySql: sql,
    evidenceSql: sql,
    needsOwnerApproval: false,
  }
}

const DETACHED_EVIDENCE =
  'SELECT database, table, reason, count() AS parts, sum(bytes_on_disk) AS bytes FROM system.detached_parts GROUP BY database, table, reason ORDER BY bytes DESC'

function detached(row: FindingRow, broken: boolean): PlanCandidate {
  return {
    ...base(row, row.metric, 'detached'),
    title: broken
      ? 'Review broken detached parts with get_detached_parts_triage'
      : 'Review detached parts with get_detached_parts_triage',
    owner: null,
    savedBytes: null,
    applyCost: NO_COST,
    risk: 'high',
    reversible: false,
    // Review-only: never a DROP DETACHED or ATTACH statement.
    ddl: [],
    verifySql: DETACHED_EVIDENCE,
    evidenceSql: DETACHED_EVIDENCE,
    needsOwnerApproval: true,
  }
}

/** The collector a finding belongs to, or null when no collector reads it. */
export function collectorOf(row: FindingRow): PlanSource | null {
  const m = row.metric
  if (m.startsWith('usage:')) return 'usage'
  if (m === 'detached_parts' || m === 'broken_detached_parts') return 'detached'
  if (
    m.startsWith('ttl_rewrite:') ||
    m.startsWith('optimize_unchanged:') ||
    m.startsWith('retention_forecast:')
  )
    return 'ttl'
  if (m.startsWith('schema_opt:')) return 'settings'
  return null
}

/** Map one persisted finding to a plan candidate, or null when not planned. */
export function candidateFromFinding(
  row: FindingRow,
  rewriteMBps?: number
): PlanCandidate | null {
  const m = row.metric
  const after = (prefix: string) => m.slice(prefix.length)
  let c: PlanCandidate | null = null
  if (m.startsWith('usage:unused_projection:'))
    c = unusedProjection(row, after('usage:unused_projection:'))
  else if (m.startsWith('usage:unread_table:'))
    c = unreadTable(row, after('usage:unread_table:'))
  else if (m.startsWith('ttl_rewrite:'))
    c = ttlRewrite(row, after('ttl_rewrite:'))
  else if (m.startsWith('optimize_unchanged:')) {
    const fq = after('optimize_unchanged:')
    c = reviewItem(
      row,
      m,
      'ttl',
      `Review the OPTIMIZE FINAL schedule on ${fq}`,
      fq,
      (db, table) =>
        `SELECT count() AS optimize_runs FROM system.query_log WHERE type = 'QueryFinish' AND event_date >= today() - 7 AND has(tables, ${sqlString(`${db}.${table}`)}) AND startsWith(upper(trimLeft(query)), 'OPTIMIZE')`
    )
  } else if (m.startsWith('retention_forecast:')) {
    const fq = after('retention_forecast:')
    c = reviewItem(
      row,
      m,
      'ttl',
      `Review retention on ${fq}`,
      fq,
      (db, table) =>
        `SELECT sum(bytes_on_disk) AS bytes, min(min_date) AS oldest, max(max_date) AS newest FROM system.parts WHERE active AND ${tableFilter(db, table)}`
    )
  } else if (m === 'detached_parts' || m === 'broken_detached_parts')
    c = detached(row, m === 'broken_detached_parts')
  else if (m.startsWith('schema_opt:')) {
    // schema_opt:<kind>:<db.table>:<slug>
    const fq = m.split(':')[2] ?? ''
    c = reviewItem(
      row,
      m,
      'settings',
      row.title,
      fq,
      (db, table) =>
        `SELECT name, type, compression_codec, formatReadableSize(data_compressed_bytes) AS compressed FROM system.columns WHERE ${tableFilter(db, table)}`
    )
  }
  if (!c) return null
  const hours = estimateHours(c.applyCost.rewriteBytes, rewriteMBps)
  return { ...c, applyCost: { ...c.applyCost, estHours: hours } }
}
