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

/**
 * Why `shouldProceed` is false:
 * - `table_missing`: the probe succeeded and the table definitively does not
 *   exist (optional-table UX: "requires configuration").
 * - `probe_failed`: the probe itself errored (network/timeout/auth) —
 *   existence is unknown, NOT confirmed missing. See issue #2505.
 */
export type TableValidationReason =
  | 'table_missing'
  | 'column_missing'
  | 'probe_failed'

export type TableValidationResult = {
  shouldProceed: boolean
  missingTables: string[]
  missingColumns?: string[]
  reason?: TableValidationReason
  error?: string
}

/** Parse `database.table.column` (column names may contain extra dots). */
export function parseColumnCheck(
  qualified: string
): { database: string; table: string; column: string } | null {
  const first = qualified.indexOf('.')
  const second = qualified.indexOf('.', first + 1)
  if (first <= 0 || second <= first + 1 || second === qualified.length - 1) {
    return null
  }
  return {
    database: qualified.slice(0, first),
    table: qualified.slice(first + 1, second),
    column: qualified.slice(second + 1),
  }
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
  const results = await Promise.all(
    tablesToCheck.map(async (fullName) => {
      const [db, tbl] = fullName.split('.')
      if (!db || !tbl) return { fullName, exists: false as const } // malformed name — treat as missing
      const exists = await tableExistenceCache.checkTableExists(hostId, db, tbl)
      return { fullName, exists }
    })
  )

  // A probe failure (network/timeout/auth) means existence is unknown, not
  // confirmed missing — surface it distinctly so callers don't render
  // "table does not exist" for what's actually a transient error.
  const unknownTables = results
    .filter((r) => r.exists === 'unknown')
    .map((r) => r.fullName)

  if (unknownTables.length > 0) {
    return {
      shouldProceed: false,
      missingTables: [],
      reason: 'probe_failed',
      error: `Could not verify table availability (connection issue): ${unknownTables.join(', ')}`,
    }
  }

  const missingTables = results
    .filter((r) => r.exists === false)
    .map((r) => r.fullName)

  if (missingTables.length > 0) {
    return {
      shouldProceed: false,
      missingTables,
      reason: 'table_missing',
    }
  }

  const columnsToCheck = ([] as string[]).concat(queryConfig.columnCheck ?? [])
  if (columnsToCheck.length === 0) {
    return { shouldProceed: true, missingTables: [] }
  }

  const columnResults = await Promise.all(
    columnsToCheck.map(async (fullName) => {
      const parsed = parseColumnCheck(fullName)
      if (!parsed) return { fullName, exists: false as const }
      const exists = await tableExistenceCache.checkColumnExists(
        hostId,
        parsed.database,
        parsed.table,
        parsed.column
      )
      return { fullName, exists }
    })
  )

  const unknownColumns = columnResults
    .filter((r) => r.exists === 'unknown')
    .map((r) => r.fullName)

  if (unknownColumns.length > 0) {
    return {
      shouldProceed: false,
      missingTables: [],
      reason: 'probe_failed',
      error: `Could not verify column availability (connection issue): ${unknownColumns.join(', ')}`,
    }
  }

  const missingColumns = columnResults
    .filter((r) => r.exists === false)
    .map((r) => r.fullName)

  return {
    shouldProceed: missingColumns.length === 0,
    missingTables: [],
    missingColumns,
    reason: missingColumns.length > 0 ? 'column_missing' : undefined,
  }
}
