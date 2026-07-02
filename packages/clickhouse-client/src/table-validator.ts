/**
 * Table Validator
 *
 * This module provides table existence validation for optional queries.
 *
 * It solves the issue where queries fail when trying to access tables that don't exist
 * (e.g., system.backup_log, system.error_log, system.zookeeper).
 *
 * Features:
 * - Caches table existence checks to avoid repeated queries
 * - Supports explicit table checking via QueryConfig.tableCheck
 * - Automatically extracts table names from SQL if not specified
 * - Gracefully handles missing tables for optional queries
 *
 * Usage:
 * 1. Mark QueryConfig with `optional: true`
 * 2. Optionally specify `tableCheck: "system.backup_log"`
 * 3. Use `fetchData` with `queryConfig` parameter
 *
 * @see https://github.com/chmonitor/chmonitor/issues/510
 */

import type { QueryConfigLike } from '@chm/sql-builder'

import { tableExistenceCache } from './table-existence-cache'
import { getAllSqlStrings } from '@chm/sql-builder'

export type TableValidationResult = {
  shouldProceed: boolean
  missingTables: string[]
  error?: string
}

export function parseTableFromSQL(sql: string): string[] {
  const tables: string[] = []

  // Enhanced regex patterns to match various SQL constructs
  const patterns = [
    // FROM and JOIN patterns - handles spaces, tabs, newlines
    /(?:FROM|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|OUTER\s+JOIN|FULL\s+JOIN)\s+(\w+\.\w+)/gi,

    // EXISTS patterns - SELECT ... WHERE EXISTS (SELECT ... FROM table)
    /EXISTS\s*\(\s*SELECT\s+[^)]*FROM\s+(\w+\.\w+)/gi,

    // IN patterns with subqueries - WHERE col IN (SELECT ... FROM table)
    /IN\s*\(\s*SELECT\s+[^)]*FROM\s+(\w+\.\w+)/gi,

    // INSERT INTO patterns
    /INSERT\s+INTO\s+(\w+\.\w+)/gi,

    // UPDATE patterns
    /UPDATE\s+(\w+\.\w+)/gi,

    // DELETE FROM patterns
    /DELETE\s+FROM\s+(\w+\.\w+)/gi,

    // CTE (WITH clause) patterns - WITH cte AS (SELECT ... FROM table)
    /WITH\s+\w+\s+AS\s*\(\s*SELECT\s+[^)]*FROM\s+(\w+\.\w+)/gi,
  ]

  patterns.forEach((pattern) => {
    const matches = sql.match(pattern)
    if (matches) {
      matches.forEach((match) => {
        // Extract table name from the match
        const tableMatch = match.match(/(\w+\.\w+)/)
        if (tableMatch) {
          const table = tableMatch[1]
          if (table && !tables.includes(table)) {
            tables.push(table)
          }
        }
      })
    }
  })

  // merge('database', 'regex') table function - aggregates data across all
  // tables in `database` whose name matches `regex` (e.g.
  // merge('system', '^query_log')). Strip regex anchors/escapes from the
  // pattern to derive a plausible table name to check existence for.
  const mergePattern = /merge\s*\(\s*'(\w+)'\s*,\s*'([^']+)'\s*\)/gi
  let mergeMatch: RegExpExecArray | null
  while ((mergeMatch = mergePattern.exec(sql)) !== null) {
    const [, database, pattern] = mergeMatch
    const tableName = pattern.replace(/^\^/, '').replace(/\\(.)/g, '$1')
    if (database && tableName) {
      const table = `${database}.${tableName}`
      if (!tables.includes(table)) {
        tables.push(table)
      }
    }
  }

  return tables
}

export async function validateTableExistence(
  queryConfig: QueryConfigLike,
  hostId: number
): Promise<TableValidationResult> {
  // Force into string[] and add SQL parsing fallback
  // For VersionedSql[], parse tables from all version variants
  const sqlStrings = queryConfig.sql ? getAllSqlStrings(queryConfig.sql) : []
  const parsedTables = sqlStrings.flatMap(parseTableFromSQL)
  const uniqueParsedTables = [...new Set(parsedTables)]

  const tablesToCheck = ([] as string[]).concat(
    queryConfig.tableCheck ?? uniqueParsedTables
  )

  if (tablesToCheck.length === 0) {
    return { shouldProceed: true, missingTables: [] }
  }

  // Check all tables in parallel
  const missingTables = (
    await Promise.all(
      tablesToCheck.map(async (fullName) => {
        const [db, tbl] = fullName.split('.')
        if (!db || !tbl) return fullName // malformed name
        const exists = await tableExistenceCache.checkTableExists(
          hostId,
          db,
          tbl
        )
        return exists ? null : fullName
      })
    )
  ).filter(Boolean) as string[]

  return {
    shouldProceed: missingTables.length === 0,
    missingTables,
  }
}
