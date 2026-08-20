/**
 * Advisor auto fine-tune engine — orchestration.
 *
 * The thin I/O layer that gathers read-only metadata, runs the pure rule
 * functions (`schema-rules.ts`, `settings-rules.ts`), ranks the findings, and
 * returns a `TuningReport`. Companion to `recommendation-engine.ts`'s
 * `analyzeQuery`, but schema-scoped rather than query-scoped.
 *
 * ABSOLUTE INVARIANT: recommend-only. Everything here is read via
 * `readOnlyQuery` (forces `clickhouse_settings.readonly = '1'`) and every
 * returned figure is inert. All queries are cheap metadata scans over
 * `system.columns` / `system.parts` / `system.settings` /
 * `system.merge_tree_settings` — no user-table data is read. Degrades
 * gracefully: an unreadable settings table drops the settings section rather
 * than failing the whole report.
 */

import type {
  ClusterContext,
  ColumnProfile,
  SettingRow,
  TableProfile,
  TuningFinding,
  TuningReport,
} from './types'

import { fetchTableTopology } from '../query-context'
import { runSchemaRules } from './schema-rules'
import { runSettingsRules } from './settings-rules'
import {
  firstSortingIdent,
  isDistributedEngine,
  runTableRules,
  ttlFromEngineFull,
} from './table-rules'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import { annotateDdlForTopology } from '@/lib/ddl/on-cluster'
import { parseDistributedEngine } from '@/lib/explorer/engine-kind'

/** System databases never worth linting. */
const SYSTEM_DATABASES = new Set([
  'system',
  'information_schema',
  'INFORMATION_SCHEMA',
])

/** Hard cap on columns scanned, so a huge schema stays a cheap query. */
const COLUMN_SCAN_LIMIT = 2000

/** Hard cap on tables scanned for TTL / engine / Distributed rules. */
const TABLE_SCAN_LIMIT = 200

const SEVERITY_ORDER: Record<TuningFinding['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export interface AnalyzeTuningInput {
  hostId: number
  database: string
  /** Optional single table; when omitted, the whole database is scanned. */
  table?: string
}

/**
 * Gather per-column bytes/type from `system.columns` (already aggregated over
 * parts) plus the owning table's active row count from `system.parts`. Ordered
 * by on-disk size so the cap keeps the biggest (highest-impact) columns.
 */
async function fetchColumnProfiles(
  hostId: number,
  database: string,
  table: string | undefined
): Promise<ColumnProfile[]> {
  const tableFilter = table ? 'AND table = {table:String}' : ''
  const [columnRows, partRows] = await Promise.all([
    readOnlyQuery({
      query: `
        SELECT
          database, table, name, type, compression_codec,
          data_compressed_bytes AS compressed_bytes,
          data_uncompressed_bytes AS uncompressed_bytes
        FROM system.columns
        WHERE database = {database:String} ${tableFilter}
        ORDER BY data_compressed_bytes DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { database, table, limit: COLUMN_SCAN_LIMIT },
      hostId,
    }) as Promise<
      Array<{
        database: string
        table: string
        name: string
        type: string
        compression_codec: string
        compressed_bytes: number | string
        uncompressed_bytes: number | string
      }>
    >,
    readOnlyQuery({
      query: `
        SELECT table, sum(rows) AS rows
        FROM system.parts
        WHERE active = 1 AND database = {database:String} ${tableFilter}
        GROUP BY table
      `,
      query_params: { database, table },
      hostId,
    }) as Promise<Array<{ table: string; rows: number | string }>>,
  ])

  const rowsByTable = new Map<string, number>()
  for (const r of partRows) rowsByTable.set(r.table, Number(r.rows))

  return columnRows.map((c) => ({
    database: c.database,
    table: c.table,
    name: c.name,
    type: c.type,
    compressionCodec: c.compression_codec ?? '',
    compressedBytes: Number(c.compressed_bytes),
    uncompressedBytes: Number(c.uncompressed_bytes),
    rows: rowsByTable.get(c.table) ?? 0,
  }))
}

type TableRow = {
  name: string
  engine: string
  engine_full: string
  sorting_key: string
  partition_key: string
  primary_key: string
}

type TablePartRow = {
  table: string
  partitions: number | string
  active_parts: number | string
  bytes_on_disk: number | string
  rows: number | string
}

function leadingSortTypeFor(
  table: string,
  sortingKey: string,
  columns: ColumnProfile[]
): string {
  const ident = firstSortingIdent(sortingKey)
  if (!ident) return ''
  const col = columns.find((c) => c.table === table && c.name === ident)
  return col?.type ?? ''
}

/**
 * Gather MergeTree (and Distributed) table metadata for table-level rules.
 * Uses `engine_full` rather than `create_table_query`. Returns `[]` (never
 * throws) if `system.tables` is unreadable.
 */
async function fetchTableProfiles(
  hostId: number,
  database: string,
  table: string | undefined,
  columns: ColumnProfile[]
): Promise<TableProfile[]> {
  const tableFilter = table ? 'AND name = {table:String}' : ''
  try {
    const [tableRows, partRows] = await Promise.all([
      readOnlyQuery({
        query: `
          SELECT
            name, engine, engine_full,
            sorting_key, partition_key, primary_key
          FROM system.tables
          WHERE is_temporary = 0
            AND database = {database:String}
            ${tableFilter}
          ORDER BY name
          LIMIT {limit:UInt32}
        `,
        query_params: { database, table, limit: TABLE_SCAN_LIMIT },
        hostId,
      }) as Promise<TableRow[]>,
      readOnlyQuery({
        query: `
          SELECT
            table,
            uniqExact(partition) AS partitions,
            count() AS active_parts,
            sum(bytes_on_disk) AS bytes_on_disk,
            sum(rows) AS rows
          FROM system.parts
          WHERE active = 1 AND database = {database:String} ${
            table ? 'AND table = {table:String}' : ''
          }
          GROUP BY table
        `,
        query_params: { database, table },
        hostId,
      }) as Promise<TablePartRow[]>,
    ])

    const partsByTable = new Map<string, TablePartRow>()
    for (const row of partRows) partsByTable.set(row.table, row)

    return tableRows.map((row) => {
      const parts = partsByTable.get(row.name)
      return {
        database,
        table: row.name,
        engine: row.engine ?? '',
        engineFull: row.engine_full ?? '',
        sortingKey: row.sorting_key ?? '',
        partitionKey: row.partition_key ?? '',
        primaryKey: row.primary_key ?? '',
        ttlExpression: ttlFromEngineFull(row.engine_full ?? ''),
        partitions: Number(parts?.partitions) || 0,
        activeParts: Number(parts?.active_parts) || 0,
        bytesOnDisk: Number(parts?.bytes_on_disk) || 0,
        rows: Number(parts?.rows) || 0,
        leadingSortType: leadingSortTypeFor(
          row.name,
          row.sorting_key ?? '',
          columns
        ),
      }
    })
  } catch {
    return []
  }
}

/**
 * Local cluster + Distributed wrappers in this database. `null` when
 * `system.clusters` is empty or unreadable (single-node / no permission).
 */
async function fetchClusterContext(
  hostId: number,
  database: string
): Promise<ClusterContext> {
  try {
    const clusterRows = (await readOnlyQuery({
      query: `
        SELECT cluster, count() AS replica_count
        FROM system.clusters
        WHERE cluster IN (
          SELECT cluster FROM system.clusters WHERE is_local = 1
        )
        GROUP BY cluster
        ORDER BY replica_count DESC, cluster
        LIMIT 1
      `,
      hostId,
    })) as Array<{ cluster: string; replica_count: number | string }>
    const cluster = clusterRows[0]?.cluster?.trim()
    const replicaCount = Number(clusterRows[0]?.replica_count) || 0
    if (!cluster || replicaCount < 1) return null

    const distRows = (await readOnlyQuery({
      query: `
        SELECT name, engine, engine_full
        FROM system.tables
        WHERE is_temporary = 0 AND database = {database:String}
      `,
      query_params: { database },
      hostId,
    })) as Array<{ name: string; engine: string; engine_full: string }>

    const distributedTargets = new Set<string>()
    const existingTables = new Set<string>()
    for (const row of distRows) {
      existingTables.add(`${database}.${row.name}`)
      if (!isDistributedEngine(row.engine)) continue
      const parsed = parseDistributedEngine(row.engine_full)
      if (parsed) {
        distributedTargets.add(`${parsed.database}.${parsed.table}`)
      }
    }

    return {
      cluster,
      replicaCount,
      distributedTargets,
      existingTables,
    }
  } catch {
    return null
  }
}

/**
 * Gather changed settings from `system.settings` and
 * `system.merge_tree_settings`. Only changed rows are pulled — the rules only
 * fire on non-default values, so this keeps the payload small. Returns `[]`
 * (never throws) if the tables can't be read.
 */
async function fetchSettings(hostId: number): Promise<SettingRow[]> {
  const rows: SettingRow[] = []
  try {
    const serverRows = (await readOnlyQuery({
      query:
        'SELECT name, toString(value) AS value, changed, toString(default) AS default FROM system.settings WHERE changed = 1',
      hostId,
    })) as Array<{
      name: string
      value: string
      changed: number | string
      default: string
    }>
    for (const r of serverRows) {
      rows.push({
        name: r.name,
        value: r.value,
        changed: Number(r.changed) === 1,
        default: r.default ?? '',
        source: 'settings',
      })
    }
  } catch {
    // settings unreadable — drop this section, keep going.
  }

  try {
    const mtRows = (await readOnlyQuery({
      query:
        'SELECT name, toString(value) AS value, changed, toString(default) AS default FROM system.merge_tree_settings WHERE changed = 1',
      hostId,
    })) as Array<{
      name: string
      value: string
      changed: number | string
      default: string
    }>
    for (const r of mtRows) {
      rows.push({
        name: r.name,
        value: r.value,
        changed: Number(r.changed) === 1,
        default: r.default ?? '',
        source: 'merge_tree_settings',
      })
    }
  } catch {
    // merge_tree_settings unreadable — drop this section, keep going.
  }

  return rows
}

/**
 * Rank findings. Schema findings sort by estimated bytes saved (desc), then
 * severity; settings findings (no bytes) sort by severity. Schema findings
 * with real byte impact come first, settings after — both interleaved by the
 * comparator so a high-severity setting still floats above a tiny schema nit.
 */
export function rankFindings(findings: TuningFinding[]): TuningFinding[] {
  return [...findings].sort((a, b) => {
    if (b.estimatedBytesSaved !== a.estimatedBytesSaved) {
      return b.estimatedBytesSaved - a.estimatedBytesSaved
    }
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  })
}

/**
 * Analyze a database (or single table) and return ranked, recommend-only
 * schema + settings tuning findings. Read-only end to end.
 */
export async function analyzeTuning(
  input: AnalyzeTuningInput
): Promise<TuningReport> {
  const { hostId, database, table } = input
  const notes: string[] = []

  if (!database || !database.trim()) {
    return { ok: false, error: 'A `database` is required.' }
  }
  if (SYSTEM_DATABASES.has(database)) {
    return {
      ok: false,
      error: `Refusing to lint the internal database "${database}" — pick one of your own databases.`,
    }
  }

  let columns: ColumnProfile[]
  try {
    columns = await fetchColumnProfiles(hostId, database, table)
  } catch (err) {
    return {
      ok: false,
      error: `Could not read schema for ${database}${table ? `.${table}` : ''}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (columns.length === 0) {
    return {
      ok: false,
      error: table
        ? `No columns found for ${database}.${table} — does the table exist?`
        : `No columns found in database "${database}" — does it exist and contain MergeTree tables?`,
    }
  }
  if (columns.length >= COLUMN_SCAN_LIMIT) {
    notes.push(
      `Scan capped at the ${COLUMN_SCAN_LIMIT} largest columns by on-disk size; smaller columns were not analyzed.`
    )
  }

  const settings = await fetchSettings(hostId)
  if (settings.length === 0) {
    notes.push(
      'No changed server/merge-tree settings were readable — the settings section is empty (all defaults, or the tables are not permitted).'
    )
  }

  const tables = await fetchTableProfiles(hostId, database, table, columns)
  if (tables.length >= TABLE_SCAN_LIMIT) {
    notes.push(
      `Table scan capped at ${TABLE_SCAN_LIMIT} tables; remaining tables were not analyzed for TTL, partitions, or engines.`
    )
  }
  const cluster = await fetchClusterContext(hostId, database)

  const findings = rankFindings([
    ...runSchemaRules(columns),
    ...runTableRules(tables, cluster),
    ...runSettingsRules(settings),
  ])

  let topology = null
  try {
    topology = await fetchTableTopology(
      hostId,
      database,
      table ?? columns[0]?.table ?? ''
    )
  } catch {
    topology = null
  }

  const annotated = findings.map((finding) => {
    const variant = annotateDdlForTopology(finding.ddl, topology)
    return {
      ...finding,
      ddl: variant.statement || finding.ddl,
      localTableName: variant.localTableName,
      onClusterStatement: variant.onClusterStatement,
      localOnlyReason: variant.localOnlyReason,
    }
  })

  return {
    ok: true,
    type: 'schema_tuning_findings',
    database,
    ...(table ? { table } : {}),
    findings: annotated,
    notes,
  }
}
