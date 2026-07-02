import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  hostIdSchema,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
} from './helpers'
import { z } from 'zod/v3'

type Severity = 'OK' | 'WARNING' | 'CRITICAL'

interface SectionReport {
  data: Array<Record<string, unknown>>
  severity: Severity
}

interface PerformanceReport {
  slow_queries: SectionReport
  high_part_counts: SectionReport
  merge_backlog: SectionReport
  memory_pressure: SectionReport
  disk_utilization: SectionReport
  errors?: string[]
}

function classifySlowQuerySeverity(
  rows: Array<Record<string, unknown>>
): Severity {
  if (!Array.isArray(rows) || rows.length === 0) return 'OK'

  const maxDuration = Math.max(
    ...rows.map((r) => Number(r.query_duration_ms ?? 0))
  )

  if (maxDuration > 60_000) return 'CRITICAL'
  if (maxDuration > 10_000) return 'WARNING'
  return 'OK'
}

function classifyPartCountSeverity(
  rows: Array<Record<string, unknown>>
): Severity {
  if (!Array.isArray(rows) || rows.length === 0) return 'OK'

  const maxParts = Math.max(...rows.map((r) => Number(r.part_count ?? 0)))

  if (maxParts > 10_000) return 'CRITICAL'
  if (maxParts > 3_000) return 'WARNING'
  return 'OK'
}

function classifyMergeSeverity(rows: Array<Record<string, unknown>>): Severity {
  if (!Array.isArray(rows) || rows.length === 0) return 'OK'

  const activeMerges = Number(rows[0]?.active_merges ?? 0)

  if (activeMerges > 20) return 'WARNING'
  return 'OK'
}

function classifyMemorySeverity(
  rows: Array<Record<string, unknown>>
): Severity {
  if (!Array.isArray(rows) || rows.length === 0) return 'OK'

  const memoryRow = rows[0]
  const memoryPct = Number(memoryRow?.memory_usage_pct ?? 0)

  if (memoryPct > 80) return 'WARNING'
  return 'OK'
}

function classifyDiskSeverity(rows: Array<Record<string, unknown>>): Severity {
  if (!Array.isArray(rows) || rows.length === 0) return 'OK'

  const minFreePct = Math.min(...rows.map((r) => Number(r.free_pct ?? 100)))

  if (minFreePct < 10) return 'CRITICAL'
  if (minFreePct < 20) return 'WARNING'
  return 'OK'
}

export function registerPerformanceTool(server: McpServer) {
  server.tool(
    'analyze_performance',
    'Get a structured performance analysis snapshot with severity ratings. Returns slow queries, high part counts, merge backlog, memory pressure, and disk utilization in one call.',
    {
      hostId: hostIdSchema,
      lastHours: z
        .number()
        .optional()
        .describe('Time window for analysis in hours (default: 1)'),
    },
    async ({ hostId, lastHours }) => {
      const h = hostId ?? 0
      const hours = Math.max(1, Math.floor(lastHours ?? 1))

      const [slowQueries, partCounts, merges, memory, disks] =
        await Promise.all([
          runReadonlyFetch({
            query: `SELECT
                query_id,
                user,
                query_duration_ms,
                read_rows,
                memory_usage,
                substring(query, 1, 200) AS query_preview
              FROM system.query_log
              WHERE type = 'QueryFinish'
                AND is_initial_query = 1
                AND event_time > now() - INTERVAL {hours:UInt32} HOUR
              ORDER BY query_duration_ms DESC
              LIMIT 5`,
            query_params: { hours: hours.toString() },
            hostId: h,
          }),
          runReadonlyFetch({
            query: `SELECT
                database,
                table,
                count() AS part_count,
                formatReadableSize(sum(bytes_on_disk)) AS total_size
              FROM system.parts
              WHERE active
              GROUP BY database, table
              ORDER BY part_count DESC
              LIMIT 5`,
            hostId: h,
          }),
          runReadonlyFetch({
            query: `SELECT
                count() AS active_merges,
                formatReadableSize(sum(total_size_bytes_compressed)) AS total_merge_size
              FROM system.merges`,
            hostId: h,
          }),
          runReadonlyFetch({
            query: `SELECT
                metric,
                value,
                round(value * 100.0 / nullIf(
                  (SELECT value FROM system.metrics WHERE metric = 'MaxMemoryUsage'), 0
                ), 2) AS memory_usage_pct
              FROM system.metrics
              WHERE metric = 'MemoryTracking'`,
            hostId: h,
          }),
          runReadonlyFetch({
            query: `SELECT
                name,
                path,
                formatReadableSize(free_space) AS free,
                formatReadableSize(total_space) AS total,
                round(free_space * 100.0 / nullIf(total_space, 0), 2) AS free_pct
              FROM system.disks`,
            hostId: h,
          }),
        ])

      const results = [slowQueries, partCounts, merges, memory, disks]
      const errors = results.filter((r) => r.error).map((r) => r.error!.message)

      if (errors.length === 5) {
        return toErrorResult(`All queries failed: ${errors.join('; ')}`)
      }

      const asArray = (data: unknown): Array<Record<string, unknown>> =>
        Array.isArray(data)
          ? data
          : data
            ? [data as Record<string, unknown>]
            : []

      const slowQueryRows = asArray(slowQueries.data)
      const partCountRows = asArray(partCounts.data)
      const mergeRows = asArray(merges.data)
      const memoryRows = asArray(memory.data)
      const diskRows = asArray(disks.data)

      const report: PerformanceReport = {
        slow_queries: {
          data: slowQueryRows,
          severity: classifySlowQuerySeverity(slowQueryRows),
        },
        high_part_counts: {
          data: partCountRows,
          severity: classifyPartCountSeverity(partCountRows),
        },
        merge_backlog: {
          data: mergeRows,
          severity: classifyMergeSeverity(mergeRows),
        },
        memory_pressure: {
          data: memoryRows,
          severity: classifyMemorySeverity(memoryRows),
        },
        disk_utilization: {
          data: diskRows,
          severity: classifyDiskSeverity(diskRows),
        },
        ...(errors.length > 0 ? { errors } : {}),
      }

      return toJsonResult(report)
    }
  )
}
