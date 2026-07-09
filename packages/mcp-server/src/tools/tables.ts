import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  capResultRows,
  hostIdSchema,
  runReadonlyFetch,
  runReadonlyQuery,
  toErrorResult,
  toJsonResult,
  truncationNote,
} from './helpers'
import { z } from 'zod/v3'

export function registerTableTools(server: McpServer) {
  server.tool(
    'list_tables',
    'List tables in a ClickHouse database with row counts and sizes, ordered by size descending.',
    {
      database: z.string().describe('Database name'),
      hostId: hostIdSchema,
    },
    async ({ database, hostId }) => {
      const result = await runReadonlyFetch({
        query:
          'SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {database:String} ORDER BY total_bytes DESC',
        hostId,
        query_params: { database },
      })

      if (result.error) {
        return toErrorResult(`Error: ${result.error.message}`)
      }

      if (!Array.isArray(result.data)) {
        return toJsonResult(result.data)
      }

      const { data, truncated } = capResultRows(result.data)
      return toJsonResult({
        data,
        truncated,
        ...(truncated && { note: truncationNote() }),
      })
    }
  )

  server.tool(
    'get_table_schema',
    'Get column definitions for a specific ClickHouse table including types, defaults, and comments.',
    {
      database: z.string().describe('Database name'),
      table: z.string().describe('Table name'),
      hostId: hostIdSchema,
    },
    async ({ database, table, hostId }) =>
      runReadonlyQuery(
        'SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
        hostId,
        { query_params: { database, table } }
      )
  )
}
