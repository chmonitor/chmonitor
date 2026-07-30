import { z } from 'zod'

import type { McpServer } from '@modelcontextprotocol/server'

import { hostIdSchema, READONLY_ANNOTATIONS, runReadonlyQuery } from './helpers'

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
  server.registerTool(
    'get_running_queries',
    {
      title: 'Get Running Queries',
      description:
        'List currently running queries on the ClickHouse server, ordered by elapsed time.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(50)
          .describe('Max number of queries to return (default: 50)'),
        hostId: hostIdSchema,
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ limit, hostId }) =>
      runReadonlyQuery(
        'SELECT query_id, user, elapsed, read_rows, memory_usage, substring(query, 1, 200) AS query FROM system.processes ORDER BY elapsed DESC LIMIT {limit:UInt32}',
        hostId,
        { query_params: { limit } }
      )
  )

  server.registerTool(
    'get_slow_queries',
    {
      title: 'Get Slow Queries',
      description:
        'Get the slowest completed queries from the query log, ordered by duration.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(10)
          .describe('Max number of queries to return (default: 10)'),
        hostId: hostIdSchema,
      },
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ limit, hostId }) =>
      runReadonlyQuery(
        "SELECT query_id, user, query_duration_ms, read_rows, memory_usage, substring(query, 1, 200) AS query, event_time FROM system.query_log WHERE type = 'QueryFinish' AND is_initial_query = 1 ORDER BY query_duration_ms DESC LIMIT {limit:UInt32}",
        hostId,
        { query_params: { limit } }
      )
  )
}
