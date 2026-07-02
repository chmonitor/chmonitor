import type { DataFormat } from '@clickhouse/client'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { hostIdSchema, runReadonlyQuery, toErrorResult } from './helpers'
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

      return runReadonlyQuery(sql, hostId, {
        format: (format ?? 'JSONEachRow') as DataFormat,
      })
    }
  )
}
