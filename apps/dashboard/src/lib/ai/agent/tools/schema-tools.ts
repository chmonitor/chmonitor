import { z } from 'zod'

import {
  capResultRows,
  hostIdSchema,
  readOnlyQuery,
  resolveHostId,
  truncationNote,
  validatedReadOnlyQuery,
} from './helpers'
import { dynamicTool } from 'ai'

export function createSchemaTools(hostId: number) {
  return {
    query: dynamicTool({
      description:
        'Execute read-only SQL queries on ClickHouse. Use this to fetch data, analyze metrics, and explore the database structure.',
      inputSchema: z.object({
        sql: z.string().describe('The SQL query to execute'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { sql, hostId: paramHostId } = input as {
          sql: string
          hostId?: number
        }
        const result = (await validatedReadOnlyQuery({
          sql,
          hostId: paramHostId ?? hostId,
        })) as unknown[]
        const { data, truncated } = capResultRows(result)
        return {
          data,
          truncated,
          ...(truncated && { note: truncationNote() }),
        }
      },
    }),

    list_databases: dynamicTool({
      description:
        'List all databases in ClickHouse with their engine and comment metadata.',
      inputSchema: z.object({
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { hostId: paramHostId } = input as { hostId?: number }
        const effectiveHostId = resolveHostId(paramHostId, hostId)
        const result = await readOnlyQuery({
          query:
            'SELECT name, engine, comment FROM system.databases ORDER BY name',
          hostId: effectiveHostId,
        })
        return result
      },
    }),

    list_tables: dynamicTool({
      description:
        'List tables in a specific database with row counts and size information.',
      inputSchema: z.object({
        database: z.string().describe('The database name'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const { database, hostId: paramHostId } = input as {
          database: string
          hostId?: number
        }
        const effectiveHostId = resolveHostId(paramHostId, hostId)
        const limit = 500
        const result = (await readOnlyQuery({
          query: `SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {database:String} ORDER BY total_bytes DESC LIMIT {limit:UInt32}`,
          hostId: effectiveHostId,
          query_params: { database, limit },
        })) as unknown[]
        const truncated = Array.isArray(result) && result.length === limit
        return {
          tables: result,
          truncated,
          ...(truncated && {
            note: `Showing the largest ${limit} tables by size; smaller tables beyond this cutoff are omitted. Query system.tables directly with a narrower filter to inspect them.`,
          }),
        }
      },
    }),

    get_table_schema: dynamicTool({
      description: 'Get the column schema for a specific table.',
      inputSchema: z.object({
        database: z.string().describe('The database name'),
        table: z.string().describe('The table name'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          database,
          table,
          hostId: paramHostId,
        } = input as {
          database: string
          table: string
          hostId?: number
        }
        const effectiveHostId = resolveHostId(paramHostId, hostId)
        const result = await readOnlyQuery({
          query:
            'SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
          hostId: effectiveHostId,
          query_params: { database, table },
        })
        return result
      },
    }),

    explore_table_schema: dynamicTool({
      description:
        'Comprehensive schema exploration. With no parameters, lists all databases. With database only, lists tables. With both, returns full schema with columns, indexes, primary keys, and foreign keys.',
      inputSchema: z.object({
        database: z.string().optional().describe('The database name'),
        table: z.string().optional().describe('The table name'),
        hostId: hostIdSchema,
      }),
      execute: async (input: unknown) => {
        const {
          database,
          table,
          hostId: paramHostId,
        } = input as {
          database?: string
          table?: string
          hostId?: number
        }
        const effectiveHostId = resolveHostId(paramHostId, hostId)

        // Mode 1: No parameters - list all databases
        if (!database) {
          const result = await readOnlyQuery({
            query:
              'SELECT name, engine, comment FROM system.databases ORDER BY name',
            hostId: effectiveHostId,
          })
          return {
            mode: 'databases',
            data: result,
          }
        }

        // Mode 2: Database only - list tables in database
        if (!table) {
          const limit = 500
          const result = (await readOnlyQuery({
            query: `SELECT name, engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = {database:String} ORDER BY name LIMIT {limit:UInt32}`,
            hostId: effectiveHostId,
            query_params: { database, limit },
          })) as unknown[]
          const truncated = Array.isArray(result) && result.length === limit
          return {
            mode: 'tables',
            database,
            data: result,
            truncated,
            ...(truncated && {
              note: `Showing the first ${limit} tables alphabetically; additional tables in this database are omitted. Query system.tables directly with a narrower filter to inspect them.`,
            }),
          }
        }

        // Mode 3: Database and table - full schema exploration
        const [columns, indexes, partitions, constraints] = await Promise.all([
          // Get columns
          readOnlyQuery({
            query:
              'SELECT name, type, default_kind, default_expression, comment FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
            hostId: effectiveHostId,
            query_params: { database, table },
          }),
          // Get indexes
          readOnlyQuery({
            query:
              'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String} ORDER BY name',
            hostId: effectiveHostId,
            query_params: { database, table },
          }),
          // Get partition info
          readOnlyQuery({
            query:
              'SELECT partition, count() AS parts, countIf(active = 0) AS inactive_parts FROM system.parts WHERE database = {database:String} AND table = {table:String} GROUP BY partition ORDER BY partition LIMIT 500',
            hostId: effectiveHostId,
            query_params: { database, table },
          }),
          // Get table constraints (primary key, etc.)
          readOnlyQuery({
            query:
              'SELECT partition_key, primary_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}',
            hostId: effectiveHostId,
            query_params: { database, table },
          }),
        ])

        // Foreign key detection - look for columns that might reference other tables
        let foreignKeys: unknown = []
        try {
          const fkCandidates = await readOnlyQuery({
            query: `SELECT c1.name as column_name, c1.type as column_type
             FROM system.columns c1
             WHERE c1.database = {database:String} AND c1.table = {table:String}
             AND (c1.name LIKE '%_id' OR c1.name LIKE '%_key')
             ORDER BY c1.name`,
            hostId: effectiveHostId,
            query_params: { database, table },
          })
          foreignKeys = fkCandidates
        } catch {
          // If FK query fails, continue without FK data
          foreignKeys = []
        }

        return {
          mode: 'schema',
          database,
          table,
          columns,
          indexes,
          partitions,
          constraints,
          foreignKeys,
        }
      },
    }),
  }
}
