/**
 * Server-side ClickHouse version detection helpers.
 *
 * Thin wrapper around @chm/clickhouse-client/clickhouse-version that adds
 * string-based convenience functions for route handlers and React hooks.
 *
 * The underlying implementation has a 24-hour per-host TTL cache so callers
 * do not need their own caching layer.
 */

import {
  type ClickHouseVersion,
  compareVersions as compareParsed,
  getClickHouseVersion,
  meetsMinVersion as meetsParsed,
  parseVersion,
} from '@chm/clickhouse-client/clickhouse-version'

export type { ClickHouseVersion }
export { parseVersion }

/**
 * Compare two version strings.
 * Returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2.
 */
export function compareVersions(v1: string, v2: string): number {
  const result = compareParsed(parseVersion(v1), parseVersion(v2))
  if (result < 0) return -1
  if (result > 0) return 1
  return 0
}

/**
 * Returns true if the given host's ClickHouse version meets the minimum.
 * Returns false if the version cannot be determined.
 *
 * @param hostId - Host index (0-based)
 * @param minVersion - Minimum required version string, e.g. "26.6"
 */
export async function meetsMinVersion(
  hostId: number,
  minVersion: string
): Promise<boolean> {
  const v = await getClickHouseVersion(hostId)
  if (!v) return false
  const min = parseVersion(minVersion)
  return meetsParsed(v, min.major, min.minor, min.patch)
}
