import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { dynamicTool } from 'ai'

export function createStorageTools(hostId: number) {
  return {
    get_table_parts: dynamicTool({
      description:
        'Get part-level information for a specific table including compression ratios.',
      inputSchema: z.object({
        database: z.string().describe('Database name'),
        table: z.string().describe('Table name'),
        active: z
          .boolean()
          .optional()
          .describe('Filter by active status (omit for all parts)'),
        limit: z
          .number()
          .optional()
          .default(100)
          .describe('Maximum number of parts to return'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          database,
          table,
          active,
          limit = 100,
          hostId: toolHostId,
        } = input as {
          database: string
          table: string
          active?: boolean
          limit?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        let whereClause =
          'WHERE database = {database:String} AND table = {table:String}'
        const params: Record<string, unknown> = { database, table, limit }

        if (active !== undefined) {
          whereClause += ' AND active = {active:UInt8}'
          params.active = active ? 1 : 0
        }

        return readOnlyQuery({
          query: `SELECT name, partition, rows, formatReadableSize(bytes_on_disk) AS size_on_disk, formatReadableSize(data_uncompressed_bytes) AS uncompressed_size, round(data_compressed_bytes * 1.0 / nullIf(data_uncompressed_bytes, 0), 3) AS compression_ratio, modification_time, level FROM system.parts ${whereClause} ORDER BY modification_time DESC LIMIT {limit:UInt32}`,
          query_params: params,
          hostId: resolvedHostId,
        })
      },
    }),

    forecast_disk_capacity: dynamicTool({
      description:
        "Forecast when this host's disks will run out of free space, projecting from system.part_log NewPart write volume over the last 30 days (plus top contributing tables). Read-only and recommend-only. Reports a clear 'enable part_log' message instead of a fabricated forecast when system.part_log isn't available.",
      inputSchema: z.object({
        horizonDays: z
          .number()
          .int()
          .positive()
          .optional()
          .default(90)
          .describe(
            'Projection horizon in days used to flag urgency (default 90).'
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { forecastDiskFull } = await import(
          '@/lib/ai/advisor/capacity-forecaster'
        )
        const { horizonDays, hostId: toolHostId } = input as {
          horizonDays?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        return forecastDiskFull(resolvedHostId, horizonDays)
      },
    }),

    suggest_ttl_adjustment: dynamicTool({
      description:
        "Recommend a TTL/retention change for a table that keeps projected disk utilization at or under 80%, never suggesting less than retentionRequirementDays (defaults to 30 if omitted). Returns a suggested `ALTER TABLE ... MODIFY TTL ...` string plus a risk note — a suggestion only, never executed. Reports a clear 'enable part_log' message instead of a fabricated suggestion when system.part_log isn't available.",
      inputSchema: z.object({
        database: z.string().describe('Database name'),
        table: z.string().describe('Table name'),
        retentionRequirementDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Minimum number of days of data that must be retained (compliance/business floor). The suggested TTL is never lower than this. Defaults to 30 if omitted — pass this explicitly whenever the real requirement differs.'
          ),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { suggestTtl, DEFAULT_RETENTION_FLOOR_DAYS } = await import(
          '@/lib/ai/advisor/capacity-forecaster'
        )
        const {
          database,
          table,
          retentionRequirementDays,
          hostId: toolHostId,
        } = input as {
          database: string
          table: string
          retentionRequirementDays?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const retentionAssumedDefault = retentionRequirementDays === undefined
        const retentionDays =
          retentionRequirementDays ?? DEFAULT_RETENTION_FLOOR_DAYS

        return suggestTtl({
          hostId: resolvedHostId,
          database,
          table,
          retentionDays,
          retentionAssumedDefault,
        })
      },
    }),
  }
}
