import { z } from 'zod'
import type { DataFormat } from '@clickhouse/client'

import type { McpServer } from '@modelcontextprotocol/server'

import {
  capResultRows,
  hostIdSchema,
  READONLY_ANNOTATIONS,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
  truncationNote,
} from './helpers'
import { validateSqlQuery } from '@chm/sql-builder'

export function registerQueryTool(server: McpServer) {
  server.registerTool(
    'query',
    {
      title: 'Run SQL Query',
      description:
        'Execute a read-only SQL query against ClickHouse. Only SELECT and WITH (CTE) queries are allowed.',
      inputSchema: {
        sql: z.string().describe('SQL query to execute (SELECT only)'),
        hostId: hostIdSchema,
        format: z
          .string()
          .optional()
          .describe('ClickHouse output format (default: JSONEachRow)'),
      },
      annotations: READONLY_ANNOTATIONS,
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
