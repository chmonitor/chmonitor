import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

/**
 * The whole `get_metrics` snapshot — server version, uptime, and the
 * connection/memory counters — in ONE read-only query.
 *
 * `groupArray` carries the `(metric, value)` pairs rather than aggregating
 * `value`. An aggregate (`maxIf`, `sumIf`, …) would report a metric
 * `system.metrics` does not publish as `0`, and would coerce a non-numeric
 * value; carrying the pairs keeps both properties of the three separate reads
 * this replaced: a missing metric stays absent, and every value arrives with
 * the type it was sent with. The pairs are sorted below so the metric keys keep
 * the alphabetical order the old `ORDER BY metric` gave them.
 *
 * No versioned `sql` array is needed: `version()`, `uptime()`, and
 * `system.metrics(metric, value)` exist on every ClickHouse version this
 * dashboard supports — `docs/clickhouse-schemas/tables/metrics.md` records no
 * documented change to that table. The metric names are a fixed allow-list, not
 * tool input, so there is nothing to pass as query params.
 */
const HEALTH_SNAPSHOT_SQL =
  "SELECT version() AS version, uptime() AS uptime_seconds, groupArray((metric, value)) AS metric_values FROM system.metrics WHERE metric IN ('TCPConnection', 'HTTPConnection', 'MemoryTracking')"

type HealthSnapshotRow = {
  version?: unknown
  uptime_seconds?: unknown
  metric_values?: unknown
}

/**
 * Fold one snapshot row into the metrics object `get_metrics` returns:
 * `version`, `uptime_seconds`, then one key per reported metric.
 */
function toHealthMetrics(row: HealthSnapshotRow): Record<string, unknown> {
  const metrics: Record<string, unknown> = {
    version: row.version,
    uptime_seconds: row.uptime_seconds,
  }

  // `metric_values` transports the pairs; it is not itself a health metric, so
  // it never reaches the caller.
  if (!Array.isArray(row.metric_values)) return metrics

  const pairs = row.metric_values
    .filter(
      (pair): pair is unknown[] => Array.isArray(pair) && pair.length >= 2
    )
    .map((pair) => [String(pair[0]), pair[1]] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  for (const [metric, value] of pairs) {
    metrics[metric] = value
  }

  return metrics
}

export function createHealthTools(hostId: number) {
  return {
    get_metrics: dynamicTool({
      description:
        'Get server health metrics including version, uptime, and connection counts.',
      inputSchema: z.object({
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { hostId: toolHostId } = input as { hostId?: number }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        const result = await readOnlyQuery({
          query: HEALTH_SNAPSHOT_SQL,
          hostId: resolvedHostId,
        })

        const rows = (result ?? []) as HealthSnapshotRow[]
        return toHealthMetrics(rows[0] ?? {})
      },
    }),

    get_disk_usage: dynamicTool({
      description: 'Get per-disk space usage including free and total space.',
      inputSchema: z.object({
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { hostId: toolHostId } = input as { hostId?: number }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        return readOnlyQuery({
          query: `SELECT name, path, formatReadableSize(free_space) AS free, formatReadableSize(total_space) AS total, round(free_space * 100.0 / nullIf(total_space, 0), 2) AS free_pct FROM system.disks ORDER BY name`,
          hostId: resolvedHostId,
        })
      },
    }),
  }
}
