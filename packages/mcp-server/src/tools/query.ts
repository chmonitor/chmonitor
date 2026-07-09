import type { DataFormat } from '@clickhouse/client'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  capResultRows,
  hostIdSchema,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
  truncationNote,
} from './helpers'
import { validateSqlQuery } from '@chm/sql-builder'
import { z } from 'zod/v3'

export function registerQueryTool(server: McpServer) {
  server.tool(
    'query',
    'Execute a read-only SQL query against ClickHouse. Only SELECT and WITH (CTE) queries are allowed.',
    {
      sql: z.string().describe('SQL query to execute (SELECT only)'),
      hostId: hostIdSchema,
      format: z
        .string()
        .optional()
        .describe('ClickHouse output format (default: JSONEachRow)'),
    },
    async ({ sql, hostId, format }) => {
      try {
        validateSqlQuery(sql)
      } catch (err) {
        return toErrorResult(
          `Validation error: ${err instanceof Error ? err.message : String(err)}`
        )
      }

      const result = await runReadonlyFetch({
        query: sql,
        hostId,
        format: (format ?? 'JSONEachRow') as DataFormat,
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
}
