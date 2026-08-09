/**
 * Constants for ClickHouse schema documentation generator
 */

/**
 * System tables to track
 */
export const TARGET_TABLES = [
  'system.processes',
  'system.query_log',
  'system.parts',
  'system.merges',
  'system.replicas',
  'system.tables',
  'system.columns',
  'system.disks',
  'system.clusters',
  'system.mutations',
  'system.replication_queue',
  'system.dictionaries',
  'system.settings',
  'system.metrics',
  'system.events',
  'system.asynchronous_metrics',
] as const

/**
 * Supported major versions
 */
export const SUPPORTED_MAJOR_VERSIONS = [23, 24, 25, 26] as const

/**
 * Known LTS versions (major.minor). Keep aligned with upstream ClickHouse LTS
 * lines that chmonitor still targets for docs + support-matrix generation.
 * As of 2026-08: 25.8 and 26.3 are current LTS series (plus older 23.x/24.x).
 */
export const LTS_VERSIONS = [
  '23.3',
  '23.8',
  '24.3',
  '24.8',
  '25.8',
  '26.3',
] as const

/**
 * GitHub URLs for fetching changelog and docs
 */
export const GITHUB_URLS = {
  changelog:
    'https://raw.githubusercontent.com/ClickHouse/ClickHouse/master/CHANGELOG.md',
  docsBase:
    'https://raw.githubusercontent.com/ClickHouse/ClickHouse/master/docs/en/operations/system-tables',
} as const

/**
 * Output directory for generated docs
 */
export const DEFAULT_OUTPUT_DIR = 'docs/clickhouse-schemas'

/**
 * Known column additions by version (seed data for common changes)
 * This helps when changelog parsing is incomplete.
 * Boundaries here should match shipped VersionedSql `since` gates where
 * configs select the column (see apps/dashboard query-config VersionedSql).
 */
export const KNOWN_COLUMN_CHANGES: Record<
  string,
  Array<{
    table: string
    column: string
    type: string
    changeType: 'added' | 'removed'
  }>
> = {
  '23.8': [
    // Enterprise baseline; no additional TARGET_TABLES column seeds.
  ],
  '24.1': [
    {
      table: 'system.query_log',
      column: 'query_cache_usage',
      type: 'Enum8',
      changeType: 'added',
    },
    {
      table: 'system.processes',
      column: 'peak_threads_usage',
      type: 'UInt64',
      changeType: 'added',
    },
  ],
  '25.12': [
    {
      table: 'system.mutations',
      column: 'parts_in_progress_names',
      type: 'Array(String)',
      changeType: 'added',
    },
  ],
  '26.1': [
    {
      table: 'system.parts',
      column: 'files',
      type: 'Array(String)',
      changeType: 'added',
    },
  ],
  '26.2': [
    {
      table: 'system.mutations',
      column: 'parts_postpone_reasons',
      type: 'Array(String)',
      changeType: 'added',
    },
  ],
  '26.6': [
    {
      table: 'system.query_log',
      column: 'client_agent',
      type: 'String',
      changeType: 'added',
    },
    {
      table: 'system.processes',
      column: 'client_agent',
      type: 'String',
      changeType: 'added',
    },
    {
      table: 'system.merges',
      column: 'current_projection',
      type: 'String',
      changeType: 'added',
    },
    {
      table: 'system.merges',
      column: 'current_projection_progress',
      type: 'Float64',
      changeType: 'added',
    },
    {
      table: 'system.merges',
      column: 'projections_completed',
      type: 'UInt64',
      changeType: 'added',
    },
    {
      table: 'system.merges',
      column: 'projections_remaining',
      type: 'UInt64',
      changeType: 'added',
    },
  ],
}
