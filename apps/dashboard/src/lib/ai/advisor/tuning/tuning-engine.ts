/**
 * Advisor tuning engine: orchestration. Gathers read-only metadata (cheap
 * scans of `system.columns` / `system.parts` / `system.settings` /
 * `system.merge_tree_settings`, no user-table data), runs the pure rules, and
 * ranks findings. An unreadable settings table drops that section rather than
 * failing the report.
 *
 * ABSOLUTE INVARIANT: recommend-only. Everything goes through `readOnlyQuery`
 * (forces `clickhouse_settings.readonly = '1'`).
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

const SYSTEM_DATABASES = new Set([
  'system',
  'information_schema',
  'INFORMATION_SCHEMA',
])

const COLUMN_SCAN_LIMIT = 2000

const TABLE_SCAN_LIMIT = 200

const SEVERITY_ORDER: Record<TuningFinding['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export interface AnalyzeTuningInput {
  hostId: number
  database: string
  table?: string
}

/** Ordered by on-disk size so the cap keeps the biggest columns. */
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
          database, table, name, type, compression_codec, is_in_sorting_key,
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
        is_in_sorting_key?: number | string | boolean
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
    isInSortingKey:
      c.is_in_sorting_key === undefined
        ? undefined
        : Number(c.is_in_sorting_key) === 1,
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

/** Uses `engine_full` rather than `create_table_query`. Returns `[]` (never throws) if `system.tables` is unreadable. */
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

/** Local cluster + Distributed wrappers; `null` when `system.clusters` is empty or unreadable. */
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

/** Only changed rows are pulled (rules fire on non-default values only). Returns `[]` if unreadable. */
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
 * Schema findings sort by estimated bytes saved, then severity; settings
 * sort by severity. The comparator interleaves them so a high-severity setting
 * still floats above a tiny schema nit.
 */
export function rankFindings(findings: TuningFinding[]): TuningFinding[] {
  return [...findings].sort((a, b) => {
    if (b.estimatedBytesSaved !== a.estimatedBytesSaved) {
      return b.estimatedBytesSaved - a.estimatedBytesSaved
    }
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  })
}

/** Read-only end to end. */
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
  const columnsP = fetchColumnProfiles(hostId, database, table)
  const settingsP = fetchSettings(hostId)
  const clusterP = fetchClusterContext(hostId, database)

  try {
    columns = await columnsP
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

  const [tables, settings, cluster] = await Promise.all([
    fetchTableProfiles(hostId, database, table, columns),
    settingsP,
    clusterP,
  ])
  if (settings.length === 0) {
    notes.push(
      'No changed server/merge-tree settings were readable — the settings section is empty (all defaults, or the tables are not permitted).'
    )
  }

  if (tables.length >= TABLE_SCAN_LIMIT) {
    notes.push(
      `Table scan capped at ${TABLE_SCAN_LIMIT} tables; remaining tables were not analyzed for TTL, partitions, or engines.`
    )
  }
  const clusterContext = cluster

  const findings = rankFindings([
    ...runSchemaRules(columns),
    ...runTableRules(tables, clusterContext),
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
