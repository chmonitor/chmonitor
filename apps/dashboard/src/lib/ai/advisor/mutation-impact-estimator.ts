/**
 * Mutation impact estimator — `ALTER TABLE ... UPDATE/DELETE` dry-run.
 *
 * Estimates the blast radius of a mutation WITHOUT ever running it: rows
 * matched by the WHERE clause, parts/bytes ClickHouse will rewrite, a
 * projected duration from recent mutation throughput history, and whether
 * free disk can hold the rewrite. Companion to `estimateQueryCost` (plan
 * 46's read-cost estimator) for the write/mutation side.
 *
 * READ-ONLY / never-execute invariant: the input is parsed as plain text
 * (see `parseMutationSql`) — it is NEVER sent to ClickHouse as-is. Only
 * derived read-only queries are executed: `SELECT count() ... WHERE
 * <parsed where clause>`, and read-only lookups against `system.parts`,
 * `system.part_log`, and `system.disks`.
 */

import { checkTableExists } from '@chm/clickhouse-client/table-existence-cache'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

// ---------------------------------------------------------------------------
// parseMutationSql — pure, no I/O
// ---------------------------------------------------------------------------

export interface ParsedMutation {
  kind: 'UPDATE' | 'DELETE'
  database: string
  table: string
  whereClause: string
}

const IDENTIFIER = '(?:`[^`]+`|"[^"]+"|[a-zA-Z_][\\w$]*)'
const TABLE_REF = `${IDENTIFIER}(?:\\s*\\.\\s*${IDENTIFIER})?`

/**
 * Matches `ALTER TABLE <table> [ON CLUSTER <name>] UPDATE ... WHERE ...` or
 * `ALTER TABLE <table> [ON CLUSTER <name>] DELETE WHERE ...`. Case-
 * insensitive, tolerant of surrounding whitespace/newlines.
 */
const MUTATION_PATTERN = new RegExp(
  `^ALTER\\s+TABLE\\s+(${TABLE_REF})\\s*(?:ON\\s+CLUSTER\\s+${IDENTIFIER}\\s*)?(UPDATE\\s+[\\s\\S]+?|DELETE)\\s+WHERE\\s+([\\s\\S]+)$`,
  'i'
)

function stripQuotedIdentifier(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``
}

/**
 * Parse an `ALTER TABLE ... UPDATE/DELETE ... WHERE ...` statement into its
 * table + WHERE clause. Throws on anything else (multiple statements, a
 * different ALTER form, no WHERE clause) — this is the tool's only gate, so
 * it must reject rather than guess.
 */
export function parseMutationSql(sql: string): ParsedMutation {
  const trimmed = sql.trim().replace(/;+\s*$/g, '')

  if (trimmed.includes(';')) {
    throw new Error(
      'Only a single ALTER TABLE ... UPDATE/DELETE statement is supported (no chained statements).'
    )
  }

  const match = trimmed.match(MUTATION_PATTERN)
  if (!match) {
    throw new Error(
      'Expected `ALTER TABLE <database>.<table> UPDATE <col> = <expr>, ... WHERE <condition>` or `ALTER TABLE <database>.<table> DELETE WHERE <condition>`.'
    )
  }

  const [, rawTable, kindPart, whereClause] = match
  const kind: 'UPDATE' | 'DELETE' = /^UPDATE\b/i.test(kindPart.trim())
    ? 'UPDATE'
    : 'DELETE'

  const parts = rawTable
    .split('.')
    .map((p) => stripQuotedIdentifier(p.trim()))
    .filter(Boolean)
  const database = parts.length > 1 ? parts[0] : 'default'
  const table = parts.length > 1 ? parts[parts.length - 1] : parts[0]

  if (!table) {
    throw new Error(
      'Could not determine the target table from the ALTER TABLE statement.'
    )
  }

  return { kind, database, table, whereClause: whereClause.trim() }
}

// ---------------------------------------------------------------------------
// estimateMutationImpact — orchestration (I/O via readOnlyQuery, mockable)
// ---------------------------------------------------------------------------

/**
 * A rewrite writes new parts before the old ones are dropped, so the mutation
 * transiently needs roughly this multiple of the rewritten bytes in free
 * space. Deliberately conservative (over-estimating the space requirement is
 * safer than under-estimating it).
 */
export const DISK_SAFETY_FACTOR = 1.2

/** History window used to estimate recent mutation throughput. */
export const THROUGHPUT_WINDOW_DAYS = 30

export type MutationImpactConfidence = 'low' | 'medium' | 'high'

export interface DiskCheck {
  name: string
  freeBytes: number
  requiredBytes: number
  sufficient: boolean
}

export interface MutationImpactEstimate {
  mutationKind: 'UPDATE' | 'DELETE'
  database: string
  table: string
  estRowsMatched: number
  estActiveParts: number
  estBytesToRewrite: number
  /** null when there is no recent MutatePart history to project from. */
  estDurationMs: number | null
  /** null when system.disks has no rows (unexpected) or the table has no parts. */
  disk: DiskCheck | null
  confidence: MutationImpactConfidence
  warnings: string[]
  summary: string
}

interface PartsTotals {
  parts: number
  bytes: number
  rows: number
}

async function fetchPartsTotals(
  hostId: number,
  database: string,
  table: string
): Promise<PartsTotals> {
  const rows = (await readOnlyQuery({
    query: `
      SELECT count() AS parts, sum(bytes_on_disk) AS bytes, sum(rows) AS rows
      FROM system.parts
      WHERE database = {database:String} AND table = {table:String} AND active
    `,
    query_params: { database, table },
    hostId,
  })) as Array<{
    parts: string | number
    bytes: string | number | null
    rows: string | number | null
  }>

  const row = rows[0]
  return {
    parts: Number(row?.parts ?? 0),
    bytes: Number(row?.bytes ?? 0),
    rows: Number(row?.rows ?? 0),
  }
}

/**
 * Recent MutatePart throughput for this table from `system.part_log`, used
 * to project a wall-clock duration for the estimated rewrite. Returns `null`
 * when `part_log` is disabled/inaccessible or has no matching history — the
 * caller degrades to `estDurationMs: null` rather than fabricating a number.
 */
async function fetchMutationThroughput(
  hostId: number,
  database: string,
  table: string
): Promise<{ bytesPerMs: number } | null> {
  const partLogEnabled = await checkTableExists(hostId, 'system', 'part_log')
  if (!partLogEnabled) return null

  const rows = (await readOnlyQuery({
    query: `
      SELECT sum(size_in_bytes) AS bytes, sum(duration_ms) AS duration_ms
      FROM system.part_log
      WHERE event_type = 'MutatePart'
        AND database = {database:String} AND table = {table:String}
        AND event_time > now() - INTERVAL {windowDays:UInt32} DAY
    `,
    query_params: { database, table, windowDays: THROUGHPUT_WINDOW_DAYS },
    hostId,
  })) as Array<{
    bytes: string | number | null
    duration_ms: string | number | null
  }>

  const bytes = Number(rows[0]?.bytes ?? 0)
  const durationMs = Number(rows[0]?.duration_ms ?? 0)
  if (bytes <= 0 || durationMs <= 0) return null

  return { bytesPerMs: bytes / durationMs }
}

interface DiskRow {
  name: string
  free_space: string | number
}

/**
 * Free space on the host's largest-free-space disk (a reasonable proxy when
 * the mutation's target disk isn't separately known — matches the
 * conservative-by-default posture of the rest of this estimator).
 */
async function fetchLargestFreeDisk(hostId: number): Promise<DiskRow | null> {
  const rows = (await readOnlyQuery({
    query: `SELECT name, free_space FROM system.disks ORDER BY free_space DESC LIMIT 1`,
    hostId,
  })) as DiskRow[]
  return rows[0] ?? null
}

function deriveConfidence(
  hasThroughputHistory: boolean,
  activeParts: number
): MutationImpactConfidence {
  if (activeParts === 0) return 'low'
  return hasThroughputHistory ? 'high' : 'medium'
}

function buildSummary(params: {
  kind: 'UPDATE' | 'DELETE'
  database: string
  table: string
  estRowsMatched: number
  estActiveParts: number
  estBytesToRewrite: number
  estDurationMs: number | null
  disk: DiskCheck | null
}): string {
  const {
    kind,
    database,
    table,
    estRowsMatched,
    estActiveParts,
    estBytesToRewrite,
    estDurationMs,
    disk,
  } = params
  const readableBytes = formatBytesShort(estBytesToRewrite)
  const durationText =
    estDurationMs === null
      ? 'unknown duration (no recent mutation history to project from)'
      : `~${formatDurationShort(estDurationMs)}`

  const diskText =
    disk === null
      ? ''
      : disk.sufficient
        ? ` Disk "${disk.name}" has enough free space (${formatBytesShort(disk.freeBytes)} free).`
        : ` WARNING: disk "${disk.name}" may NOT have enough free space (${formatBytesShort(disk.freeBytes)} free, ~${formatBytesShort(disk.requiredBytes)} needed).`

  return (
    `${kind} on ${database}.${table} matches an estimated ${estRowsMatched.toLocaleString()} row(s) ` +
    `and will rewrite up to ${estActiveParts} active part(s) (~${readableBytes}), taking ${durationText}.` +
    diskText
  )
}

function formatBytesShort(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unitIndex]}`
}

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(1)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

/**
 * Estimate the impact of an `ALTER TABLE ... UPDATE/DELETE` mutation without
 * ever executing it.
 *
 * READ-ONLY / never-execute: `sql` is parsed as plain text (never sent to
 * ClickHouse) to extract the target table and WHERE clause; only derived
 * read-only queries run — a `SELECT count() ... WHERE <clause>` against the
 * target table, plus lookups against `system.parts`, `system.part_log`, and
 * `system.disks`.
 */
export async function estimateMutationImpact(params: {
  sql: string
  hostId: number
}): Promise<MutationImpactEstimate> {
  const { hostId } = params
  const { kind, database, table, whereClause } = parseMutationSql(params.sql)
  const warnings: string[] = []

  const qualifiedTable = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`

  const [rowsMatchedResult, partsTotals, throughput, disk] = await Promise.all([
    readOnlyQuery({
      query: `SELECT count() AS matched FROM ${qualifiedTable} WHERE ${whereClause}`,
      hostId,
    }) as Promise<Array<{ matched: string | number }>>,
    fetchPartsTotals(hostId, database, table),
    fetchMutationThroughput(hostId, database, table),
    fetchLargestFreeDisk(hostId),
  ])

  const estRowsMatched = Number(rowsMatchedResult[0]?.matched ?? 0)
  const {
    parts: estActiveParts,
    bytes: estBytesToRewrite,
    rows: totalRows,
  } = partsTotals

  if (estActiveParts === 0) {
    warnings.push(
      `No active parts found for ${database}.${table} — the table may be empty, not a MergeTree engine, or the name is wrong.`
    )
  } else {
    warnings.push(
      "Mutations rewrite every active part that could contain a matching row, and ClickHouse does not expose per-partition WHERE pruning ahead of time — parts/bytes to rewrite are reported as the table's full active footprint, which likely over-estimates impact when the WHERE clause targets only a subset of partitions."
    )
  }

  if (totalRows > 0 && estRowsMatched === 0) {
    warnings.push(
      'The WHERE clause matched 0 rows — this mutation would be a no-op.'
    )
  }

  const estDurationMs =
    throughput === null
      ? null
      : Math.round(estBytesToRewrite / throughput.bytesPerMs)

  if (throughput === null) {
    warnings.push(
      'No recent MutatePart history for this table in system.part_log (or part_log is disabled) — duration is unknown rather than guessed.'
    )
  }

  let diskCheck: DiskCheck | null = null
  if (disk) {
    const freeBytes = Number(disk.free_space)
    const requiredBytes = Math.round(estBytesToRewrite * DISK_SAFETY_FACTOR)
    diskCheck = {
      name: disk.name,
      freeBytes,
      requiredBytes,
      sufficient: freeBytes >= requiredBytes,
    }
    if (!diskCheck.sufficient) {
      warnings.push(
        `Disk "${disk.name}" has ${formatBytesShort(freeBytes)} free but the rewrite needs ~${formatBytesShort(requiredBytes)} (${DISK_SAFETY_FACTOR}x the rewritten bytes, since new parts are written before old ones are dropped) — this mutation may fail or fill the disk.`
      )
    }
  } else {
    warnings.push('No disk information available from system.disks.')
  }

  const confidence = deriveConfidence(throughput !== null, estActiveParts)

  const summary = buildSummary({
    kind,
    database,
    table,
    estRowsMatched,
    estActiveParts,
    estBytesToRewrite,
    estDurationMs,
    disk: diskCheck,
  })

  return {
    mutationKind: kind,
    database,
    table,
    estRowsMatched,
    estActiveParts,
    estBytesToRewrite,
    estDurationMs,
    disk: diskCheck,
    confidence,
    warnings,
    summary,
  }
}
