/**
 * ClickHouse Version Detection and Compatibility
 *
 * Provides utilities for detecting ClickHouse versions and selecting
 * appropriate query variants based on version capabilities.
 *
 * IMPORTANT: This module uses getClient directly instead of fetchData
 * to avoid circular dependency (fetchData calls getClickHouseVersion).
 *
 * Version history of relevant system tables:
 * - system.metrics: Always available
 * - system.metric_log: Introduced ~20.x, requires configuration
 * - system.asynchronous_metric_log: Introduced ~20.x, requires configuration
 * - system.part_log: Available in most versions
 * - merge() function: Available since early versions
 *
 * @see https://clickhouse.com/docs/operations/system-tables
 */

import type { VersionedSql } from '@chm/sql-builder'

// Use getClient directly to avoid circular dependency with fetchData.
import { getClient } from './clickhouse/clickhouse-client'
import { getClickHouseConfigs } from './clickhouse/clickhouse-config'
import { QUERY_COMMENT } from './clickhouse/constants'
import { debug, error as logError } from '@chm/logger'

/**
 * Parsed ClickHouse version
 */
export interface ClickHouseVersion {
  major: number
  minor: number
  patch: number
  build?: number
  raw: string
}

/**
 * Version cache to avoid repeated queries
 * Key: hostId, Value: { version, timestamp }
 */
const versionCache = new Map<
  number,
  { version: ClickHouseVersion; timestamp: number }
>()

// Cache TTL: 24 hours (version only changes on server upgrade)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Parse a version string like "24.3.1.1" into components
 */
export function parseVersion(versionStr: string): ClickHouseVersion {
  const parts = versionStr.split('.')
  return {
    major: parseInt(parts[0] || '0', 10),
    minor: parseInt(parts[1] || '0', 10),
    patch: parseInt(parts[2] || '0', 10),
    build: parts[3] ? parseInt(parts[3], 10) : undefined,
    raw: versionStr,
  }
}

/**
 * Compare two versions: returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(
  a: ClickHouseVersion,
  b: ClickHouseVersion
): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  return 0
}

/**
 * Check if version meets minimum requirement
 */
export function meetsMinVersion(
  version: ClickHouseVersion,
  minMajor: number,
  minMinor = 0,
  minPatch = 0
): boolean {
  const min = { major: minMajor, minor: minMinor, patch: minPatch, raw: '' }
  return compareVersions(version, min) >= 0
}

/**
 * Get cached version or fetch from ClickHouse
 *
 * Uses raw client directly to avoid circular dependency with fetchData.
 * fetchData calls getClickHouseVersion for version-aware query selection,
 * so we can't use fetchData here.
 */
export async function getClickHouseVersion(
  hostId: number
): Promise<ClickHouseVersion | null> {
  // Check cache first
  const cached = versionCache.get(hostId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.version
  }

  try {
    // Get client config for this host
    const configs = getClickHouseConfigs()
    const clientConfig = configs[hostId]

    if (!clientConfig) {
      logError(
        `[clickhouse-version] Invalid hostId: ${hostId}, available: 0-${configs.length - 1}`
      )
      return null
    }

    // Use raw client to avoid circular dependency with fetchData
    const client = await getClient({ clientConfig })
    const resultSet = await client.query({
      query: `${QUERY_COMMENT}SELECT version() as version`,
      format: 'JSONEachRow',
    })

    const data = (await resultSet.json()) as { version: string }[]
    const versionStr = data?.[0]?.version

    if (!versionStr) {
      logError('[clickhouse-version] Failed to get version from response')
      return null
    }

    const version = parseVersion(versionStr)
    versionCache.set(hostId, { version, timestamp: Date.now() })

    debug(`[clickhouse-version] Host ${hostId}: ${version.raw}`)
    return version
  } catch (err) {
    logError('[clickhouse-version] Error fetching version:', err)
    return null
  }
}

/**
 * Check if a specific table exists on the host
 * Uses raw client to avoid circular dependency with fetchData
 */
export async function checkTableExists(
  hostId: number,
  database: string,
  table: string
): Promise<boolean> {
  try {
    const configs = getClickHouseConfigs()
    const clientConfig = configs[hostId]
    if (!clientConfig) return false

    const client = await getClient({ clientConfig })
    const resultSet = await client.query({
      query:
        QUERY_COMMENT +
        `SELECT count() > 0 as exists FROM system.tables WHERE database = {database:String} AND name = {table:String}`,
      query_params: { database, table },
      format: 'JSONEachRow',
    })

    const data = (await resultSet.json()) as { exists: number }[]
    return data?.[0]?.exists === 1
  } catch {
    return false
  }
}

/**
 * Check if a table has data (is not empty)
 * Uses raw client to avoid circular dependency with fetchData
 */
export async function checkTableHasData(
  hostId: number,
  fullTableName: string
): Promise<boolean> {
  try {
    const configs = getClickHouseConfigs()
    const clientConfig = configs[hostId]
    if (!clientConfig) return false

    const client = await getClient({ clientConfig })
    const resultSet = await client.query({
      query:
        QUERY_COMMENT +
        `SELECT count() > 0 as has_data FROM ${fullTableName} LIMIT 1`,
      format: 'JSONEachRow',
    })

    const data = (await resultSet.json()) as { has_data: number }[]
    return data?.[0]?.has_data === 1
  } catch {
    return false
  }
}

/**
 * Table availability info
 */
export interface TableAvailability {
  exists: boolean
  hasData: boolean
  message?: string
}

/**
 * Check table availability with data status
 */
export async function checkTableAvailability(
  hostId: number,
  database: string,
  table: string
): Promise<TableAvailability> {
  const exists = await checkTableExists(hostId, database, table)
  if (!exists) {
    return {
      exists: false,
      hasData: false,
      message: `Table ${database}.${table} does not exist. It may require configuration in ClickHouse.`,
    }
  }

  const hasData = await checkTableHasData(hostId, `${database}.${table}`)
  if (!hasData) {
    return {
      exists: true,
      hasData: false,
      message: `Table ${database}.${table} exists but contains no data.`,
    }
  }

  return { exists: true, hasData: true }
}

/**
 * Known system tables and their requirements
 */
export const SYSTEM_TABLE_INFO: Record<
  string,
  {
    minVersion?: { major: number; minor?: number }
    requiresConfig?: boolean
    configKey?: string
    description: string
  }
> = {
  'system.metric_log': {
    minVersion: { major: 20, minor: 5 },
    requiresConfig: true,
    configKey: 'metric_log',
    description:
      'Historical metrics log. Requires <metric_log> in server config.',
  },
  'system.asynchronous_metric_log': {
    minVersion: { major: 20, minor: 5 },
    requiresConfig: true,
    configKey: 'asynchronous_metric_log',
    description:
      'Historical async metrics. Requires <asynchronous_metric_log> in server config.',
  },
  'system.part_log': {
    requiresConfig: true,
    configKey: 'part_log',
    description:
      'Part operations log. Requires <part_log> in server config. Usually enabled by default.',
  },
  'system.query_log': {
    requiresConfig: true,
    configKey: 'query_log',
    description:
      'Query execution log. Requires <query_log> in server config. Usually enabled by default.',
  },
  'system.backup_log': {
    minVersion: { major: 22 },
    requiresConfig: true,
    configKey: 'backup_log',
    description:
      'Backup operations log. Requires backup configuration and <backup_log> in server config.',
  },
  'system.error_log': {
    minVersion: { major: 22, minor: 8 },
    requiresConfig: true,
    configKey: 'error_log',
    description:
      'Error log. Requires <error_log> in server config. Available since 22.8.',
  },
  'system.zookeeper': {
    requiresConfig: true,
    description:
      'ZooKeeper data. Requires ZooKeeper/Keeper configuration in server.',
  },
}

/**
 * Get info message for a system table
 */
export function getTableInfoMessage(fullTableName: string): string {
  const info = SYSTEM_TABLE_INFO[fullTableName]
  if (!info) {
    return `Table ${fullTableName} may require specific configuration.`
  }
  return info.description
}

/**
 * Clear version cache (useful for testing)
 */
export function clearVersionCache(): void {
  versionCache.clear()
}

/**
 * Check if a version string matches a range
 */
export function versionMatchesRange(
  version: ClickHouseVersion,
  minVersion?: string,
  maxVersion?: string
): boolean {
  if (minVersion) {
    const min = parseVersion(minVersion)
    if (compareVersions(version, min) < 0) {
      return false
    }
  }

  if (maxVersion) {
    const max = parseVersion(maxVersion)
    if (compareVersions(version, max) >= 0) {
      return false
    }
  }

  return true
}

/**
 * Structured bounds for semver range parsing
 */
export interface SemverRangeBounds {
  min?: ClickHouseVersion
  max?: ClickHouseVersion
  minInclusive: boolean
  maxInclusive: boolean
}

/**
 * Parse a semver range string into structured bounds
 *
 * Supports multiple formats:
 * - ">=24.1" → min 24.1 inclusive
 * - "<24.5" → max 24.5 exclusive
 * - ">=24.1 <24.5" → range with min inclusive, max exclusive
 * - ">=24.1 <=24.5" → range with both inclusive
 * - "^24.1" → >=24.1 <25.0 (caret: compatible with version, allow minor/patch changes)
 * - "~24.1.2" → >=24.1.2 <24.2.0 (tilde: compatible with version, allow patch changes only)
 * - "24.1" → >=24.1 <25.0 (shorthand, same as ^24.1)
 *
 * @param range - Semver range string
 * @returns Parsed bounds with inclusive/exclusive flags
 *
 * @example
 * // Parse simple range
 * const bounds = parseSemverRange('>=24.1 <24.5')
 * // → { min: {major: 24, minor: 1, ...}, max: {major: 24, minor: 5, ...},
 * //     minInclusive: true, maxInclusive: false }
 *
 * @example
 * // Parse caret range
 * const bounds = parseSemverRange('^24.1.2')
 * // → { min: {major: 24, minor: 1, patch: 2, ...},
 * //     max: {major: 25, minor: 0, patch: 0, ...},
 * //     minInclusive: true, maxInclusive: false }
 *
 * @example
 * // Parse tilde range
 * const bounds = parseSemverRange('~24.1.2')
 * // → { min: {major: 24, minor: 1, patch: 2, ...},
 * //     max: {major: 24, minor: 2, patch: 0, ...},
 * //     minInclusive: true, maxInclusive: false }
 */
export function parseSemverRange(range: string): SemverRangeBounds {
  const bounds: SemverRangeBounds = {
    minInclusive: true,
    maxInclusive: true,
  }

  // Handle empty or whitespace-only range
  if (!range || !range.trim()) {
    return bounds
  }

  const trimmed = range.trim()

  // Handle caret (^) - allows minor and patch updates
  // ^24.1.2 → >=24.1.2 <25.0.0
  if (trimmed.startsWith('^')) {
    const version = parseVersion(trimmed.slice(1))
    bounds.min = version
    bounds.minInclusive = true
    bounds.max = {
      major: version.major + 1,
      minor: 0,
      patch: 0,
      raw: `${version.major + 1}.0.0`,
    }
    bounds.maxInclusive = false
    return bounds
  }

  // Handle tilde (~) - allows patch updates only
  // ~24.1.2 → >=24.1.2 <24.2.0
  if (trimmed.startsWith('~')) {
    const version = parseVersion(trimmed.slice(1))
    bounds.min = version
    bounds.minInclusive = true
    bounds.max = {
      major: version.major,
      minor: version.minor + 1,
      patch: 0,
      raw: `${version.major}.${version.minor + 1}.0`,
    }
    bounds.maxInclusive = false
    return bounds
  }

  // Handle compound ranges like ">=24.1 <24.5"
  const parts = trimmed.split(/\s+/)
  for (const part of parts) {
    if (part.startsWith('>=')) {
      bounds.min = parseVersion(part.slice(2))
      bounds.minInclusive = true
    } else if (part.startsWith('>')) {
      bounds.min = parseVersion(part.slice(1))
      bounds.minInclusive = false
    } else if (part.startsWith('<=')) {
      bounds.max = parseVersion(part.slice(2))
      bounds.maxInclusive = true
    } else if (part.startsWith('<')) {
      bounds.max = parseVersion(part.slice(1))
      bounds.maxInclusive = false
    } else if (part.startsWith('=') || part.match(/^\d/)) {
      // Handle plain version number as "^version" (allow minor/patch changes)
      const version = parseVersion(part.startsWith('=') ? part.slice(1) : part)
      bounds.min = version
      bounds.minInclusive = true
      bounds.max = {
        major: version.major + 1,
        minor: 0,
        patch: 0,
        raw: `${version.major + 1}.0.0`,
      }
      bounds.maxInclusive = false
    }
  }

  return bounds
}

/**
 * Check if a version matches a semver range string
 *
 * @param version - ClickHouse version to check
 * @param range - Semver range string (e.g., ">=24.1", "^24.1", ">=24.1 <24.5")
 * @returns true if version matches the range, false otherwise
 *
 * @example
 * const v = parseVersion('24.3.1.1')
 * matchesSemverRange(v, '>=24.1 <24.5') // true
 * matchesSemverRange(v, '^24.1') // true (>=24.1 <25.0)
 * matchesSemverRange(v, '~24.3.1') // false (requires >=24.3.1)
 * matchesSemverRange(v, '<24.1') // false
 */
export function matchesSemverRange(
  version: ClickHouseVersion,
  range: string
): boolean {
  const bounds = parseSemverRange(range)

  // Check minimum version
  if (bounds.min) {
    const cmp = compareVersions(version, bounds.min)
    if (bounds.minInclusive) {
      if (cmp < 0) return false
    } else {
      if (cmp <= 0) return false
    }
  }

  // Check maximum version
  if (bounds.max) {
    const cmp = compareVersions(version, bounds.max)
    if (bounds.maxInclusive) {
      if (cmp > 0) return false
    } else {
      if (cmp >= 0) return false
    }
  }

  return true
}

/**
 * Selects the appropriate SQL query based on ClickHouse version.
 *
 * Uses the new "since" format where queries are defined chronologically
 * (oldest → newest) and the system picks the highest `since` version
 * that is <= current ClickHouse version.
 *
 * @param sqlDef - Either a simple string or array of VersionedSql
 * @param currentVersion - ClickHouse version (null-safe)
 * @returns The selected SQL query string
 *
 * @example
 * const sql = selectVersionedSql([
 *   { since: '23.8', sql: 'SELECT col1 FROM t' },
 *   { since: '24.1', sql: 'SELECT col1, col2 FROM t' },
 * ], parseVersion('24.5.1.1'))
 * // Returns: 'SELECT col1, col2 FROM t' (24.1 is highest <= 24.5)
 */
export function selectVersionedSql(
  sqlDef: string | VersionedSql[],
  currentVersion: ClickHouseVersion | null
): string {
  // If simple string, return as-is
  if (typeof sqlDef === 'string') {
    return sqlDef
  }

  // If empty array, throw error
  if (!Array.isArray(sqlDef) || sqlDef.length === 0) {
    throw new Error('VersionedSql array cannot be empty')
  }

  // If no version info, return oldest (first) query as fallback
  if (!currentVersion) {
    return sqlDef[0].sql
  }

  // Sort entries by version descending (newest first)
  // Create shallow copy to avoid mutating original array
  const sortedSql = [...sqlDef].sort((a, b) => {
    const versionA = parseVersion(a.since)
    const versionB = parseVersion(b.since)
    return compareVersions(versionB, versionA) // Descending order
  })

  // Find highest `since` version that current version satisfies (>=)
  for (const entry of sortedSql) {
    const sinceVersion = parseVersion(entry.since)
    if (compareVersions(currentVersion, sinceVersion) >= 0) {
      return entry.sql
    }
  }

  // If no match, return oldest (first in original array) as fallback
  return sqlDef[0].sql
}
