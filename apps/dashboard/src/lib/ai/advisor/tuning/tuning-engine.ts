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
  ColumnProfile,
  SettingRow,
  TuningFinding,
  TuningReport,
} from './types'

import { runSchemaRules } from './schema-rules'
import { runSettingsRules } from './settings-rules'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

/** System databases never worth linting. */
const SYSTEM_DATABASES = new Set([
  'system',
  'information_schema',
  'INFORMATION_SCHEMA',
])

/** Hard cap on columns scanned, so a huge schema stays a cheap query. */
const COLUMN_SCAN_LIMIT = 2000

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

  const findings = rankFindings([
    ...runSchemaRules(columns),
    ...runSettingsRules(settings),
  ])

  return {
    ok: true,
    type: 'schema_tuning_findings',
    database,
    ...(table ? { table } : {}),
    findings,
    notes,
  }
}
