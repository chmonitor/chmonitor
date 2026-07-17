import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { hostIdSchema, READONLY_ANNOTATIONS, runReadonlyQuery } from './helpers'
import { z } from 'zod/v3'

/**
 * Registers two MCP tools on the provided server for inspecting ClickHouse queries.
 *
 * The tools added are:
 * - `get_running_queries`: lists currently running queries ordered by elapsed time.
 * - `get_slow_queries`: retrieves the slowest completed queries from the query log ordered by duration.
 *
 * @param server - MCP server instance on which to register the tools
 */
export function registerQueryTools(server: McpServer) {
  server.tool(
    'get_running_queries',
    'List currently running queries on the ClickHouse server, ordered by elapsed time.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(50)
        .describe('Max number of queries to return (default: 50)'),
      hostId: hostIdSchema,
    },
    { ...READONLY_ANNOTATIONS, title: 'Get Running Queries' },
    async ({ limit, hostId }) =>
      runReadonlyQuery(
        'SELECT query_id, user, elapsed, read_rows, memory_usage, substring(query, 1, 200) AS query FROM system.processes ORDER BY elapsed DESC LIMIT {limit:UInt32}',
        hostId,
        { query_params: { limit } }
      )
  )

  server.tool(
    'get_slow_queries',
    'Get the slowest completed queries from the query log, ordered by duration.',
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(10)
        .describe('Max number of queries to return (default: 10)'),
      hostId: hostIdSchema,
    },
    { ...READONLY_ANNOTATIONS, title: 'Get Slow Queries' },
    async ({ limit, hostId }) =>
      runReadonlyQuery(
        "SELECT query_id, user, query_duration_ms, read_rows, memory_usage, substring(query, 1, 200) AS query, event_time FROM system.query_log WHERE type = 'QueryFinish' AND is_initial_query = 1 ORDER BY query_duration_ms DESC LIMIT {limit:UInt32}",
        hostId,
        { query_params: { limit } }
      )
  )
}
