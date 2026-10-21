/**
 * ClickHouse Capability Discovery + Diff Harness
 *
 * Turns raw system.tables / system.columns / version() introspection into a
 * deterministic capability snapshot and a snapshot diff. Seeds Plan 10:
 *   10a — this file (pure harness)
 *   10b — CI matrix runner
 *   10c — automated per-version diff generation
 *   10d — capability-first query resolver
 *
 * Flavor / version helpers (parseMajorMinor, detectChFlavor, ChFlavor) are
 * imported from lib/telemetry/environment — single source of truth; NOT
 * replicated here.
 */

import {
  type ChFlavor,
  detectChFlavor,
  parseMajorMinor,
} from '../telemetry/environment'

/**
 * A normalised, deterministic snapshot of a ClickHouse instance's capability
 * surface: which system tables + columns exist, what version/flavor it is, and
 * which build flags are active.
 */
export interface CapabilitySnapshot {
  /** ClickHouse version string returned by version() */
  version: string
  /** Parsed "MAJOR.MINOR" (e.g. "24.8"), or undefined when absent/unparseable */
  majorMinor: string | undefined
  /** Detected distribution flavor */
  flavor: ChFlavor
  /**
   * Map from fully-qualified table key → sorted column name list.
   *
   * Key format:
   *   - "database.table" when the database name is present and non-empty
   *   - "table"          when the database name is absent / empty
   *
   * Both tables and columns lists are sorted and deduplicated to guarantee
   * stable diffs regardless of query result order.
   */
  tables: Record<string, string[]>
  /**
   * Sorted build flag key → value pairs from system.build_options.
   * Omitted (undefined) when no build options were supplied.
   */
  buildFlags: Record<string, string> | undefined
}

/**
 * Raw inputs fed into normalizeCapabilities().  All fields are optional so
 * callers can supply whatever they have discovered.
 */
export interface CapabilityInput {
  version?: string | null
  /** Rows from system.tables (or a subset of it) */
  tables?: Array<{ database?: string | null; name: string }>
  /** Rows from system.columns */
  columns?: Array<{
    database?: string | null
    table: string
    name: string
  }>
  /** Key-value pairs from system.build_options */
  buildOptions?: Array<{ name: string; value: string }>
}

export interface CapabilityDiff {
  /** Tables present in `next` but not in `baseline` */
  addedTables: string[]
  /** Tables present in `baseline` but not in `next` */
  removedTables: string[]
  /**
   * Per-table columns added in `next` (only for tables present in BOTH
   * snapshots — tables that appear in only one snapshot are not listed here).
   */
  addedColumns: Record<string, string[]>
  /**
   * Per-table columns removed in `next` (same constraint as addedColumns).
   */
  removedColumns: Record<string, string[]>
  /** True when `baseline.version !== next.version` */
  versionChanged: boolean
}

/**
 * Minimal ClickHouse client interface required by discoverCapabilities().
 * Compatible with @clickhouse/client and @clickhouse/client-web result shapes.
 */
export interface ChClient {
  query(params: {
    query: string
    format?: string
  }): Promise<{ json(): Promise<unknown> }>
}

/** Build the canonical table key from an optional database + table name. */
function tableKey(database: string | null | undefined, table: string): string {
  return database && database.length > 0 ? `${database}.${table}` : table
}

/**
 * Build a deterministic CapabilitySnapshot from raw discovery inputs.
 *
 * Guarantees:
 *  - table keys are sorted
 *  - column arrays per table are sorted and deduplicated
 *  - buildFlags keys are sorted (omitted when buildOptions is empty/absent)
 */
export function normalizeCapabilities(
  input: CapabilityInput
): CapabilitySnapshot {
  const version = input.version ?? ''

  // --- tables map: key → Set<column> ---
  const tableMap = new Map<string, Set<string>>()

  // Seed from table rows (creates empty sets for tables with no column info)
  for (const row of input.tables ?? []) {
    const key = tableKey(row.database, row.name)
    if (!tableMap.has(key)) {
      tableMap.set(key, new Set())
    }
  }

  for (const row of input.columns ?? []) {
    const key = tableKey(row.database, row.table)
    if (!tableMap.has(key)) {
      tableMap.set(key, new Set())
    }
    tableMap.get(key)!.add(row.name)
  }

  const sortedKeys = [...tableMap.keys()].sort()
  const tables: Record<string, string[]> = {}
  for (const key of sortedKeys) {
    tables[key] = [...tableMap.get(key)!].sort()
  }

  let buildFlags: Record<string, string> | undefined
  if (input.buildOptions && input.buildOptions.length > 0) {
    const sortedOptions = [...input.buildOptions].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )
    buildFlags = {}
    for (const opt of sortedOptions) {
      buildFlags[opt.name] = opt.value
    }
  }

  return {
    version,
    majorMinor: parseMajorMinor(version),
    flavor: detectChFlavor(version),
    tables,
    buildFlags,
  }
}

/**
 * Compute the diff between two capability snapshots.
 *
 * addedColumns / removedColumns are only populated for tables that exist in
 * BOTH snapshots — tables that appear in only one side go into
 * addedTables / removedTables instead.
 */
export function diffCapabilities(
  baseline: CapabilitySnapshot,
  next: CapabilitySnapshot
): CapabilityDiff {
  const baseKeys = new Set(Object.keys(baseline.tables))
  const nextKeys = new Set(Object.keys(next.tables))

  const addedTables = [...nextKeys].filter((k) => !baseKeys.has(k)).sort()
  const removedTables = [...baseKeys].filter((k) => !nextKeys.has(k)).sort()

  const commonTables = [...baseKeys].filter((k) => nextKeys.has(k)).sort()

  const addedColumns: Record<string, string[]> = {}
  const removedColumns: Record<string, string[]> = {}

  for (const table of commonTables) {
    const baseCols = new Set(baseline.tables[table])
    const nextCols = new Set(next.tables[table])

    const added = [...nextCols].filter((c) => !baseCols.has(c)).sort()
    const removed = [...baseCols].filter((c) => !nextCols.has(c)).sort()

    if (added.length > 0) addedColumns[table] = added
    if (removed.length > 0) removedColumns[table] = removed
  }

  return {
    addedTables,
    removedTables,
    addedColumns,
    removedColumns,
    versionChanged: baseline.version !== next.version,
  }
}

/**
 * Introspect a live ClickHouse instance and return a normalised capability
 * snapshot.
 *
 * Queries:
 *  1. SELECT version()
 *  2. SELECT database, name FROM system.tables WHERE database = 'system'
 *  3. SELECT database, table, name FROM system.columns WHERE database = 'system'
 *  4. SELECT name, value FROM system.build_options
 *
 * Not unit-tested (requires a real client). Covered by integration tests
 * that spin up a live ClickHouse instance (Plan 10b CI matrix).
 */
export async function discoverCapabilities(
  client: ChClient
): Promise<CapabilitySnapshot> {
  const [versionRes, tablesRes, columnsRes, buildOptionsRes] =
    await Promise.all([
      client.query({ query: 'SELECT version() AS version', format: 'JSON' }),
      client.query({
        query:
          "SELECT database, name FROM system.tables WHERE database = 'system' ORDER BY name",
        format: 'JSON',
      }),
      client.query({
        query:
          "SELECT database, table, name FROM system.columns WHERE database = 'system' ORDER BY table, name",
        format: 'JSON',
      }),
      client.query({
        query: 'SELECT name, value FROM system.build_options ORDER BY name',
        format: 'JSON',
      }),
    ])

  const versionData = (await versionRes.json()) as {
    data: Array<{ version: string }>
  }
  const tablesData = (await tablesRes.json()) as {
    data: Array<{ database: string; name: string }>
  }
  const columnsData = (await columnsRes.json()) as {
    data: Array<{ database: string; table: string; name: string }>
  }
  const buildOptionsData = (await buildOptionsRes.json()) as {
    data: Array<{ name: string; value: string }>
  }

  return normalizeCapabilities({
    version: versionData.data[0]?.version ?? '',
    tables: tablesData.data,
    columns: columnsData.data,
    buildOptions: buildOptionsData.data,
  })
}
