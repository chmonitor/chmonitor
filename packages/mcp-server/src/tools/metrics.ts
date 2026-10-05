import type { McpServer } from '@modelcontextprotocol/server'

import {
  hostIdSchema,
  READONLY_ANNOTATIONS,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
} from './helpers'

/**
 * The whole health snapshot in one read (#3644).
 *
 * The tool used to issue three independent reads — `version()`, `uptime()`,
 * and three rows of `system.metrics` — inside a `Promise.all`. Those three
 * `system.metrics` names are the same ones the query always asked for and the
 * only tool input is `hostId`, which never reaches the SQL (it selects a
 * configured client), so there is nothing here to interpolate and nothing to
 * sanitize.
 *
 * `version()` and `uptime()` are constant scalars, so they ride along on the
 * single aggregated row instead of needing a join or a second round trip:
 *
 *  - `groupArray` over an empty match yields `[]`, never a dropped row, so a
 *    cluster that does not expose `TCPConnection` / `HTTPConnection` still
 *    gets version and uptime — same as the three-read version did.
 *  - `arraySort` reproduces the previous `ORDER BY metric`: it compares tuples
 *    element-wise, so it orders on the metric name first, and `metric` is the
 *    primary key of `system.metrics` so no tie can occur. `groupArray` itself
 *    makes no promise about input order once more than one thread reads the
 *    table, so without the sort the payload could come back reordered between
 *    calls. The default comparator is used deliberately — a lambda would add
 *    a higher-order-function dependency for no extra guarantee.
 *
 * Column and function availability is version-independent here. The repo's
 * support floor is ClickHouse 23.3 (`docs/content/reference/support-matrix.mdx`
 * — supported series 23/24/25/26) and everything used here predates it:
 * `version()` + `uptime()` are already combined without a version gate in
 * `apps/dashboard/src/lib/query-config/system/cluster-live-metrics.ts`,
 * `groupArray`/`arraySort` are long-standing aggregates, and
 * `docs/clickhouse-schemas/tables/metrics.md` records no change to
 * `system.metrics` at all. So one unconditional statement is correct — no
 * `VersionedSql` gate needed.
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
 * Rebuild the `{ metric, value }` rows the three-read version returned.
 *
 * JSONEachRow serializes ClickHouse's `Array(Tuple(String, Int64))` as an
 * array of two-element arrays, so the tuple pairs are lifted back into objects
 * here rather than at the tool boundary. An entry that is already an object is
 * passed through untouched, and a non-array payload is returned as-is, so a
 * response shape the client already produced survives unchanged.
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
