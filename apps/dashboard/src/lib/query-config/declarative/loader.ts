/**
 * Declarative config loader — Plan 02b.
 *
 * Converts a validated DeclarativeQueryConfig into the in-memory QueryConfig
 * shape that the dashboard consumes at runtime.
 *
 * RUNTIME-ONLY FIELDS NOT PRESENT ON LOADED CONFIGS:
 *   - columnIcons    — React component refs (Icon type)
 *   - filterSchema   — FilterSchema (contains Icon refs and dynamic option fns)
 *   - columnFilters  — ColumnFilterDef (UI sugar over filterSchema)
 *   - inline-JSX expandable — bespoke per-row React (keep as a TS config)
 *   - variants       — deprecated; use versioned sql[] in the declarative format
 *
 * Compiled fields (declarative spec → runtime value on the loaded config):
 *   - rowStyle    → rowClassName function (see compileRowStyle)
 *   - permission  → FeaturePermission (plain data, carried through)
 *   - expandable  → ExpandableConfig (see compileExpandable)
 *
 * These fields can be merged in by the caller after loading if needed.
 */

import type { QueryConfig } from '@/types/query-config'
import type { DeclarativeQueryConfig } from './schema'

import { compileExpandable } from './expandable'
import { compileRowStyle } from './row-style'
import { validateDeclarativeConfig } from './validate'

// ---------------------------------------------------------------------------
// Config source flag
// ---------------------------------------------------------------------------

export type ConfigSource = 'ts' | 'declarative'

/**
 * Read the CHM_CONFIG_SOURCE flag.
 *
 * Server: CHM_CONFIG_SOURCE runtime env wins, then falls back to the
 * build-time VITE_CONFIG_SOURCE (same pattern as getServerAuthProvider).
 * Client: VITE_CONFIG_SOURCE build-time value only.
 *
 * Anything other than the literal string 'declarative' returns 'ts' —
 * fail-safe to the current behaviour. Default is 'ts'.
 *
 * @param runtimeEnv - Pass the Cloudflare Worker `env` binding or
 *   process.env; omit on the client (uses import.meta.env only).
 */
export function getConfigSource(
  runtimeEnv?: Record<string, string | undefined>
): ConfigSource {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  const value =
    (source as Record<string, string | undefined>).CHM_CONFIG_SOURCE ??
    import.meta.env.VITE_CONFIG_SOURCE
  return value === 'declarative' ? 'declarative' : 'ts'
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load a declarative config object into the in-memory QueryConfig shape.
 *
 * Validates `input` against the declarative schema (throws on invalid), then
 * maps all serializable fields to their QueryConfig equivalents. The mapping
 * is 1-to-1: field names and value shapes are shared by design.
 *
 * Runtime-only fields absent from DeclarativeQueryConfig (columnIcons,
 * expandable, permission, filterSchema, columnFilters, variants) are simply
 * omitted from the result. Callers that need those fields must merge them in
 * after loading. (rowClassName is produced from the declarative rowStyle rules.)
 *
 * @throws Error when `input` fails schema validation (message includes all
 *   field-level errors joined by '; ').
 */
export function loadDeclarativeConfig(input: unknown): QueryConfig {
  const result = validateDeclarativeConfig(input)
  if (!result.ok) {
    throw new Error(
      `Invalid declarative query config: ${result.errors.join('; ')}`
    )
  }

  const d: DeclarativeQueryConfig = result.config

  // Build the QueryConfig, mapping only the serializable fields the schema
  // carries. Undefined optional fields are omitted (no key set) so the result
  // is a clean object — callers can spread-merge additional fields without
  // accidental undefined overrides.
  const config: QueryConfig = {
    name: d.name,
    sql: d.sql,
    columns: d.columns as string[],
  }

  // Identity / display
  if (d.description !== undefined) config.description = d.description
  if (d.docs !== undefined) config.docs = d.docs
  if (d.suggestion !== undefined) config.suggestion = d.suggestion

  // Execution knobs
  if (d.optional !== undefined) config.optional = d.optional
  if (d.tableCheck !== undefined) config.tableCheck = d.tableCheck
  if (d.disableSqlValidation !== undefined)
    config.disableSqlValidation = d.disableSqlValidation
  if (d.refreshInterval !== undefined)
    config.refreshInterval = d.refreshInterval
  if (d.defaultParams !== undefined) config.defaultParams = d.defaultParams
  if (d.clickhouseSettings !== undefined) {
    // Schema validates values to serializable primitives; cast to the precise
    // ClickHouseSettings type from @clickhouse/client.
    config.clickhouseSettings =
      d.clickhouseSettings as QueryConfig['clickhouseSettings']
  }

  // Column display
  if (d.columnFormats !== undefined) {
    // DeclarativeQueryConfig.columnFormats uses the same string-enum values as
    // ColumnFormat (the enum values ARE those strings). Cast is safe — schema
    // validates the allowed strings to exactly the ColumnFormat enum domain.
    config.columnFormats = d.columnFormats as QueryConfig['columnFormats']
  }
  if (d.columnDescriptions !== undefined)
    config.columnDescriptions = d.columnDescriptions
  if (d.columnSizing !== undefined) config.columnSizing = d.columnSizing
  if (d.tableBehavior !== undefined) config.tableBehavior = d.tableBehavior

  // Filters
  if (d.filterParamPresets !== undefined)
    config.filterParamPresets = d.filterParamPresets

  // Related charts — schema: (string | [string, Record])[] which is a
  // structural subset of QueryConfig's (string | [string, ChartProps])[].
  if (d.relatedCharts !== undefined) {
    config.relatedCharts = d.relatedCharts as QueryConfig['relatedCharts']
  }

  // Card / view
  if (d.card !== undefined) config.card = d.card as QueryConfig['card']
  if (d.defaultView !== undefined) config.defaultView = d.defaultView

  // Bulk actions
  if (d.bulkActions !== undefined) config.bulkActions = d.bulkActions
  if (d.bulkActionKey !== undefined) config.bulkActionKey = d.bulkActionKey

  // Sorting
  if (d.sortingFns !== undefined) {
    config.sortingFns = d.sortingFns as QueryConfig['sortingFns']
  }

  // Row styling — compile declarative rules into a rowClassName function.
  if (d.rowStyle !== undefined) {
    config.rowClassName = compileRowStyle(d.rowStyle)
  }

  // Feature-permission gate — plain data, structurally identical to
  // FeaturePermission (schema validates feature/access/operation to its domain).
  if (d.permission !== undefined) {
    config.permission = d.permission as QueryConfig['permission']
  }

  // Expandable row-detail panel — compile the declarative spec into an
  // ExpandableConfig by binding the matching row-detail factory.
  if (d.expandable !== undefined) {
    config.expandable = compileExpandable(d.expandable)
  }

  return config
}
