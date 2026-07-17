import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  capResultRows,
  hostIdSchema,
  READONLY_ANNOTATIONS,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
  truncationNote,
} from './helpers'
import { z } from 'zod/v3'

export function registerExploreTableSchemaTool(server: McpServer) {
  server.tool(
    'explore_table_schema',
    'Comprehensive schema exploration with relationship discovery. Three modes: no params (list databases), database only (summarize tables), database+table (full schema with relationships)',
    {
      database: z
        .string()
        .optional()
        .describe('Database name (optional - if omitted, lists all databases)'),
      table: z
        .string()
        .optional()
        .describe(
          'Table name (requires database. If provided, returns full schema with relationships)'
        ),
      hostId: hostIdSchema,
    },
    { ...READONLY_ANNOTATIONS, title: 'Explore Table Schema' },
    async ({ database, table, hostId }) => {
      // Mode 1: No params — list databases
      if (!database) {
        const result = await runReadonlyFetch({
          query:
            'SELECT name, engine, comment FROM system.databases ORDER BY name',
          hostId,
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

      // Mode 2: Database only — list tables with details
      if (!table) {
        const result = await runReadonlyFetch({
          query: `SELECT name, engine, partition_key, sorting_key, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {database:String} AND is_temporary = 0 AND name NOT LIKE '.inner_%' ORDER BY total_bytes DESC`,
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

      // Mode 3: Database + table — full schema with relationships
      const [metadataResult, columnsResult, upstreamResult, downstreamResult] =
        await Promise.all([
          runReadonlyFetch({
            query: `SELECT database, name, engine, partition_key, sorting_key, primary_key, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {database:String} AND name = {table:String}`,
            query_params: { database, table },
            hostId,
          }),
          runReadonlyFetch({
            query: `SELECT name, type, is_in_primary_key, is_in_sorting_key, is_in_partition_key FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position`,
            query_params: { database, table },
            hostId,
          }),
          runReadonlyFetch({
            query: `SELECT t2.database AS dep_database, t2.name AS dep_table, t2.engine FROM system.tables AS t1 INNER JOIN system.tables AS t2 ON t1.create_table_query LIKE concat('%', t2.database, '.', t2.name, '%') WHERE t1.database = {database:String} AND t1.name = {table:String} AND t2.database != '' AND NOT (t2.database = {database:String} AND t2.name = {table:String})`,
            query_params: { database, table },
            hostId,
          }),
          runReadonlyFetch({
            query: `SELECT t2.database AS dependent_database, t2.name AS dependent_table, t2.engine FROM system.tables AS t1 INNER JOIN system.tables AS t2 ON t2.create_table_query LIKE concat('%', t1.database, '.', t1.name, '%') WHERE t1.database = {database:String} AND t1.name = {table:String} AND t2.database != '' AND NOT (t2.database = {database:String} AND t2.name = {table:String})`,
            query_params: { database, table },
            hostId,
          }),
        ])

      const errors = [
        metadataResult,
        columnsResult,
        upstreamResult,
        downstreamResult,
      ]
        .filter((r) => r.error)
        .map((r) => r.error!.message)

      if (errors.length > 0) {
        return toErrorResult(`Errors: ${errors.join('; ')}`)
      }

      const tableMetadata = Array.isArray(metadataResult.data)
        ? metadataResult.data[0]
        : metadataResult.data

      const cappedColumns = capResultRows(
        Array.isArray(columnsResult.data) ? columnsResult.data : []
      )
      const cappedUpstream = capResultRows(
        Array.isArray(upstreamResult.data) ? upstreamResult.data : []
      )
      const cappedDownstream = capResultRows(
        Array.isArray(downstreamResult.data) ? downstreamResult.data : []
      )
      const truncated =
        cappedColumns.truncated ||
        cappedUpstream.truncated ||
        cappedDownstream.truncated

      const combined = {
        table: tableMetadata,
        columns: cappedColumns.data,
        upstream_dependencies: cappedUpstream.data,
        downstream_dependencies: cappedDownstream.data,
        truncated,
        ...(truncated && { note: truncationNote() }),
      }

      return toJsonResult(combined)
    }
  )
}
