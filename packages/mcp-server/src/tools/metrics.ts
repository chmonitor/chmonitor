import type { McpServer } from '@modelcontextprotocol/server'

import {
  hostIdSchema,
  READONLY_ANNOTATIONS,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
} from './helpers'

/**
 * Whole health snapshot in one read. `version()` and `uptime()` ride along on
 * the single aggregated row.
 *
 *  - `groupArray` over an empty match yields `[]`, never a dropped row, so a
 *    cluster without `TCPConnection` / `HTTPConnection` still gets version and
 *    uptime.
 *  - `arraySort` fixes the order: `groupArray` makes no ordering promise under
 *    multi-threaded reads, and tuples sort on the metric name first (the
 *    primary key of `system.metrics`, so no ties).
 *
 * Nothing used here changed since the 23.3 support floor, so no `VersionedSql`
 * gate is needed.
 */
const HEALTH_SNAPSHOT_SQL = `SELECT
    version() AS version,
    uptime() AS uptime_seconds,
    arraySort(groupArray((metric, value))) AS metrics
  FROM (
    SELECT metric, value
    FROM system.metrics
    WHERE metric IN ('TCPConnection', 'HTTPConnection', 'MemoryTracking')
  )`

/**
 * JSONEachRow serializes `Array(Tuple(String, Int64))` as two-element arrays;
 * lift them back into `{ metric, value }` objects. Objects and non-arrays pass
 * through untouched.
 */
function toMetricRows(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map((entry) =>
    Array.isArray(entry) ? { metric: entry[0], value: entry[1] } : entry
  )
}

export function registerMetricsTool(server: McpServer) {
  server.registerTool(
    'get_metrics',
    {
      title: 'Get Server Metrics',
      description:
        'Get key ClickHouse server metrics: version, uptime, active connections, and memory usage.',
      inputSchema: {
        hostId: hostIdSchema,
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ hostId }) => {
      const snapshot = await runReadonlyFetch({
        query: HEALTH_SNAPSHOT_SQL,
        hostId,
      })

      if (snapshot.error) {
        return toErrorResult(`Error: ${snapshot.error.message}`)
      }

      const snapshotRow = (
        Array.isArray(snapshot.data) ? snapshot.data[0] : snapshot.data
      ) as Record<string, unknown> | undefined

      return toJsonResult({
        version: snapshotRow?.version,
        uptime_seconds: snapshotRow?.uptime_seconds,
        metrics: toMetricRows(snapshotRow?.metrics),
      })
    }
  )
}
