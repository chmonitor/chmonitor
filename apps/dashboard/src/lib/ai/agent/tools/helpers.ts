/**
 * Shared helpers for agent tool implementations.
 *
 * Provides common query execution patterns to eliminate boilerplate
 * across tool category files.
 */

import { z } from 'zod'
import type { DataFormat } from '@clickhouse/client'

import { fetchData } from '@chm/clickhouse-client'
import { validateSqlQuery } from '@chm/sql-builder'

/**
 * Simple in-memory LRU cache for metadata queries.
 * Cached per request with 60-second TTL to reduce redundant ClickHouse queries.
 */
class MetadataCache {
  private cache = new Map<string, { data: unknown; expires: number }>()
  private readonly DEFAULT_TTL = 60000 // 60 seconds

  private getCacheKey(
    hostId: number,
    query: string,
    params?: Record<string, unknown>
  ): string {
    const paramsStr = params ? JSON.stringify(params) : ''
    return `${hostId}:${query}:${paramsStr}`
  }

  get(
    hostId: number,
    query: string,
    params?: Record<string, unknown>
  ): unknown | null {
    const key = this.getCacheKey(hostId, query, params)
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expires) {
      this.cache.delete(key)
      return null
    }
    return entry.data
  }

  set(
    hostId: number,
    query: string,
    data: unknown,
    params?: Record<string, unknown>,
    ttl = this.DEFAULT_TTL
  ): void {
    const key = this.getCacheKey(hostId, query, params)
    this.cache.set(key, { data, expires: Date.now() + ttl })
  }

  clear(): void {
    this.cache.clear()
  }
}

/**
 * Global metadata cache instance.
 * Cleared between agent requests to prevent stale data.
 */
export const metadataCache = new MetadataCache()

/**
 * Resolve the effective host ID from tool input and default.
 */
export function resolveHostId(
  toolHostId: number | undefined,
  defaultHostId: number
): number {
  return toolHostId ?? defaultHostId
}

/**
 * Execute a read-only query against ClickHouse.
 * Validates SQL, sets readonly mode, and returns data or throws.
 * Uses metadata cache for schema/metadata queries.
 */
export async function readOnlyQuery(options: {
  query: string
  hostId: number
  format?: DataFormat
  query_params?: Record<string, unknown>
  useCache?: boolean
}): Promise<unknown> {
  const {
    query,
    hostId,
    format = 'JSONEachRow',
    query_params,
    useCache = false,
  } = options

  // Check cache for metadata queries
  if (useCache) {
    const cached = metadataCache.get(hostId, query, query_params)
    if (cached !== null) {
      return cached
    }
  }

  const result = await fetchData({
    query,
    hostId,
    format,
    query_params,
    clickhouse_settings: { readonly: '1' },
  })

  if (result.error) {
    throw new Error(result.error.message)
  }

  // Cache successful metadata query results
  if (useCache) {
    metadataCache.set(hostId, query, result.data, query_params)
  }

  return result.data
}

/**
 * Execute a validated read-only SQL query (user-provided SQL).
 * Runs SQL validation before execution.
 */
export async function validatedReadOnlyQuery(options: {
  sql: string
  hostId: number
  format?: DataFormat
}): Promise<unknown> {
  const { sql, hostId, format = 'JSONEachRow' } = options

  try {
    validateSqlQuery(sql)
  } catch (err) {
    throw new Error(
      `Validation error: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return readOnlyQuery({ query: sql, hostId, format })
}

/**
 * Max rows returned to the model by the freeform-SQL tools (`query`,
 * `query_and_visualize`). Dedicated tools cap independently (e.g. list_tables
 * at 500 rows); this bounds agent-authored SQL that has no LIMIT, matching
 * the "default to 1000 rows" guidance in SEC_PERFORMANCE_CONSTRAINTS.
 * Mirrored in packages/mcp-server/src/tools/helpers.ts for the standalone
 * MCP server's own `query` tool (separate implementation, no shared code).
 */
export const MAX_QUERY_RESULT_ROWS = 1000

/**
 * Cap an array of query result rows to `maxRows`, flagging truncation so the
 * caller can surface a visible note to the model instead of silently
 * dropping rows.
 */
export function capResultRows<T>(
  data: T[],
  maxRows: number = MAX_QUERY_RESULT_ROWS
): { data: T[]; truncated: boolean } {
  if (!Array.isArray(data) || data.length <= maxRows) {
    return { data, truncated: false }
  }
  return { data: data.slice(0, maxRows), truncated: true }
}

/**
 * Human-readable note explaining a truncated result set, matching the
 * `list_tables` truncation-note shape/wording.
 */
export function truncationNote(
  maxRows: number = MAX_QUERY_RESULT_ROWS
): string {
  return `Results truncated to ${maxRows} rows. Add a LIMIT clause or aggregate the query to see the full result set.`
}

/**
 * Execute a write query (KILL, OPTIMIZE, etc.) against ClickHouse.
 * No readonly setting. Use only for control actions.
 */
export async function writeQuery(options: {
  query: string
  hostId: number
  query_params?: Record<string, unknown>
}): Promise<unknown> {
  const { query, hostId, query_params } = options

  const result = await fetchData({
    query,
    hostId,
    query_params,
  })

  if (result.error) {
    throw new Error(result.error.message)
  }

  return result.data
}

/**
 * Valid SQL identifier pattern for table names.
 * Reused from actions route for consistent validation.
 */
const VALID_TABLE_IDENTIFIER =
  /^(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)(\.\s*(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*))?$/

/**
 * Validate table identifier to prevent SQL injection.
 */
export function isValidTableIdentifier(table: string): boolean {
  if (!table || table.length > 256) return false
  return VALID_TABLE_IDENTIFIER.test(table.trim())
}

/**
 * Standardized schema for ClickHouse host ID overriding.
 * Preprocesses null, empty string, and whitespace-only strings into undefined
 * to prevent silent coercion to host 0, while coercing integer values safely.
 */
export const hostIdSchema = z
  .preprocess((val) => {
    if (val === null || val === undefined) return undefined
    if (typeof val === 'string' && val.trim() === '') return undefined
    return val
  }, z.coerce.number().int().nonnegative().optional())
  .describe('Override host ID')

/**
 * Standardized schema for required ClickHouse host IDs.
 * Preprocesses null, empty string, and whitespace-only strings into undefined
 * to trigger validation failures instead of silent coercion to host 0.
 */
export const requiredHostIdSchema = z.preprocess((val) => {
  if (val === null || val === undefined) return undefined
  if (typeof val === 'string' && val.trim() === '') return undefined
  return val
}, z.coerce.number().int().nonnegative())
