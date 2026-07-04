import { z } from 'zod'

import { hostIdSchema, readOnlyQuery, resolveHostId } from './helpers'
import { validateSqlQuery } from '@chm/sql-builder'
import { dynamicTool } from 'ai'

export function createQueryTools(hostId: number) {
  return {
    get_running_queries: dynamicTool({
      description:
        'Get currently running queries. Useful for identifying long-running queries and monitoring active workloads.',
      inputSchema: z.object({
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { hostId: toolHostId } = input as { hostId?: number }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const result = await readOnlyQuery({
          query: `
            SELECT
              query_id,
              user,
              elapsed,
              read_rows,
              memory_usage,
              substring(query, 1, 200) AS query
            FROM system.processes
            ORDER BY elapsed DESC
            LIMIT 100
          `,
          hostId: resolvedHostId,
        })
        return result
      },
    }),

    get_slow_queries: dynamicTool({
      description:
        'Get the slowest completed queries. Useful for identifying performance bottlenecks and slow query patterns.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(10)
          .describe('Number of queries to return'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { limit = 10, hostId: toolHostId } = input as {
          limit?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const result = await readOnlyQuery({
          query: `
            SELECT
              query_id,
              user,
              query_duration_ms,
              read_rows,
              memory_usage,
              substring(query, 1, 200) AS query,
              event_time
            FROM system.query_log
            WHERE type = 'QueryFinish' AND is_initial_query = 1
            ORDER BY query_duration_ms DESC
            LIMIT {limit:UInt32}
          `,
          query_params: { limit: limit.toString() },
          hostId: resolvedHostId,
        })
        return result
      },
    }),

    get_failed_queries: dynamicTool({
      description:
        'Get recent failed queries. Useful for troubleshooting errors and understanding query failures.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .default(20)
          .describe('Number of failed queries to return'),
        lastHours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .optional()
          .default(24)
          .describe('Time window in hours'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          limit = 20,
          lastHours = 24,
          hostId: toolHostId,
        } = input as {
          limit?: number
          lastHours?: number
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)
        const result = await readOnlyQuery({
          query: `
            SELECT
              query_id,
              user,
              exception_code,
              substring(exception, 1, 300) AS error,
              query_duration_ms,
              event_time,
              substring(query, 1, 200) AS query
            FROM system.query_log
            WHERE type = 'ExceptionWhileProcessing' AND event_time > now() - INTERVAL {lastHours:UInt32} HOUR
            ORDER BY event_time DESC
            LIMIT {limit:UInt32}
          `,
          query_params: {
            limit: limit.toString(),
            lastHours: lastHours.toString(),
          },
          hostId: resolvedHostId,
        })
        return result
      },
    }),

    explain_query: dynamicTool({
      description:
        'Get the execution plan for a query (EXPLAIN PLAN / PIPELINE / PLAN indexes=1). Useful for understanding query optimization and identifying performance issues.',
      inputSchema: z.object({
        sql: z.string().describe('SQL query to explain'),
        type: z
          .enum(['plan', 'pipeline', 'indexes'])
          .optional()
          .default('plan')
          .describe('Type of explanation'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          sql,
          type = 'plan',
          hostId: toolHostId,
        } = input as {
          sql: string
          type?: 'plan' | 'pipeline' | 'indexes'
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        // Map type to ClickHouse EXPLAIN keyword.
        // 'indexes' is not a standalone EXPLAIN mode; it is a PLAN setting.
        const typeMap: Record<string, string> = {
          plan: 'PLAN',
          pipeline: 'PIPELINE',
        }

        validateSqlQuery(sql)

        const explainQuery =
          type === 'indexes'
            ? `EXPLAIN PLAN indexes=1 ${sql}`
            : `EXPLAIN ${typeMap[type]} ${sql}`

        const result = await readOnlyQuery({
          query: explainQuery,
          hostId: resolvedHostId,
        })
        return result
      },
    }),

    list_slow_query_patterns: dynamicTool({
      description:
        'List NORMALIZED slow query patterns — system.query_log aggregated by normalized_query_hash, one row per distinct query shape, with calls, total/avg/p50/p95/p99/max duration, CPU time, peak memory, read/write bytes, error count, and cache-hit ratio. Use this (not `get_slow_queries`) when the question is about which *kind* of query is expensive overall or runs often, or as the first step of a "why is my database slow?" investigation — `get_slow_queries` instead returns individual query executions ranked by single-run duration and does not group repeated queries together.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(10)
          .describe(
            'Number of top patterns to return, ranked by total duration'
          ),
        lastHours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .optional()
          .default(24)
          .describe('Time window in hours (default 24)'),
        user: z.string().optional().describe('Restrict to this user'),
        queryKind: z
          .string()
          .optional()
          .describe('Restrict to this query_kind (e.g. Select, Insert)'),
        database: z.string().optional().describe('Restrict to this database'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { getTableQuery } = await import('@/lib/api/table-registry')
        const { executeTableConfig } = await import('@/lib/api/query-executor')
        const {
          limit = 10,
          lastHours = 24,
          user,
          queryKind,
          database,
          hostId: toolHostId,
        } = input as {
          limit?: number
          lastHours?: number
          user?: string
          queryKind?: string
          database?: string
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        const searchParams: Record<string, string> = {
          event_time: `withinHours:${lastHours}`,
        }
        if (user) searchParams.user = `eq:${user}`
        if (queryKind) searchParams.query_kind = `eq:${queryKind}`
        if (database) searchParams.database = `eq:${database}`

        const tableQuery = getTableQuery('slow-query-patterns', {
          hostId: resolvedHostId,
          searchParams,
        })
        if (!tableQuery) {
          throw new Error('slow-query-patterns query config not found')
        }

        const { result } = await executeTableConfig(
          tableQuery.queryConfig,
          resolvedHostId,
          tableQuery.queryParams
        )

        if (result.error) {
          throw new Error(result.error.message)
        }

        return (result.data ?? []).slice(0, limit)
      },
    }),

    estimate_query_cost: dynamicTool({
      description:
        'Pre-flight cost estimate for a query from EXPLAIN alone: estimated rows scanned, bytes read, peak memory, and wall time, plus a confidence level and any caveats. Read-only and recommend-only — runs EXPLAIN only and never executes the analyzed query. Use this before running a query you suspect might be expensive, or to rank optimization impact.',
      inputSchema: z.object({
        sql: z.string().describe('SQL query to estimate the cost of'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { estimateQueryCost } = await import(
          '@/lib/ai/advisor/cost-estimator'
        )
        const { sql, hostId: toolHostId } = input as {
          sql: string
          hostId?: number
        }
        const resolvedHostId = resolveHostId(toolHostId, hostId)

        return estimateQueryCost({ sql, hostId: resolvedHostId })
      },
    }),
  }
}
