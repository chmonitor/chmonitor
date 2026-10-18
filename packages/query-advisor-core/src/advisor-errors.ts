/**
 * Shared "cannot analyze" classification for the dashboard engine,
 * `/api/v1/advisor`, and the MCP tool. Pure: callers still run
 * `validateSqlQuery` (in `@chm/sql-builder`) themselves.
 */

import type { ReferencedTable } from './types'

import { extractReferencedTables } from './sql-parsing'

export const ADVISOR_ERROR_CODES = [
  'missing_input',
  'invalid_sql',
  'no_target_table',
  'query_not_found',
  'schema_unavailable',
] as const

export type AdvisorErrorCode = (typeof ADVISOR_ERROR_CODES)[number]

export const ADVISOR_NO_TARGET_TABLE_MESSAGE =
  'This query does not read a table. Paste a SELECT with FROM, or pick a slow query, so the advisor can suggest skip indexes, projections, and PREWHERE.'

export interface AdvisorInputError {
  ok: false
  code: AdvisorErrorCode
  error: string
}

export interface AdvisorTargetTableOk {
  ok: true
  table: ReferencedTable
}

export type AdvisorTargetTableResult = AdvisorTargetTableOk | AdvisorInputError

/**
 * User-input issues the UI should explain with EmptyState + next steps.
 * Schema/host failures stay on ErrorAlert.
 */
export function isAdvisorUserInputError(
  code: string | undefined
): code is Exclude<AdvisorErrorCode, 'schema_unavailable'> {
  return (
    code === 'missing_input' ||
    code === 'invalid_sql' ||
    code === 'no_target_table' ||
    code === 'query_not_found'
  )
}

export function advisorNoTargetTableError(): AdvisorInputError {
  return {
    ok: false,
    code: 'no_target_table',
    error: ADVISOR_NO_TARGET_TABLE_MESSAGE,
  }
}

/**
 * Find the first real FROM/JOIN table. Queries like `SELECT 1` fail closed
 * with `no_target_table` instead of proceeding to schema lookup.
 */
export function findAdvisorTargetTable(
  sql: string,
  defaultDatabase = 'default'
): AdvisorTargetTableResult {
  const table = extractReferencedTables(sql, defaultDatabase)[0]
  if (!table) return advisorNoTargetTableError()
  return { ok: true, table }
}
