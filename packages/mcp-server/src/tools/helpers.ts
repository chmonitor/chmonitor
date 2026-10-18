import { z } from 'zod'
import type { DataFormat } from '@clickhouse/client'

import type { FetchDataResult } from '@chm/clickhouse-client'
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/server'

import { fetchData } from '@chm/clickhouse-client'

export const hostIdSchema = z
  .number()
  .optional()
  .describe('Host index (default: 0)')

/**
 * Uniform across every tool: all run through {@link runReadonlyFetch}, which
 * forces `clickhouse_settings.readonly = '1'`, and the freeform `query` tool is
 * restricted to SELECT/WITH by `validateSqlQuery`. Only the operator's own
 * ClickHouse hosts are contacted, hence `openWorldHint: false`. Spread into each
 * `server.registerTool(...)` and add a tool-specific `title`.
 */
export const READONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

export function toErrorResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  }
}

/**
 * Pre-2026 revisions type `structuredContent` as an object, so arrays and
 * scalars are wrapped as `{ data }`.
 */
export function toStructuredContent(data: unknown): Record<string, unknown> {
  const isPlainObject =
    typeof data === 'object' && data !== null && !Array.isArray(data)
  return isPlainObject
    ? (data as Record<string, unknown>)
    : { data: data ?? null }
}

/** Emits both `content` text (pre-2025 clients) and `structuredContent`. */
export function toJsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: toStructuredContent(data),
  }
}

type FetchableData =
  | unknown[]
  | object[]
  | Record<string, unknown>
  | { length: number; rows: number; statistics: Record<string, unknown> }

interface ReadonlyFetchOptions {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
  format?: DataFormat
}

function buildFetchArgs(options: ReadonlyFetchOptions) {
  return {
    query: options.query,
    hostId: options.hostId ?? 0,
    format: options.format ?? ('JSONEachRow' as DataFormat),
    clickhouse_settings: { readonly: '1' as const },
    ...(options.query_params ? { query_params: options.query_params } : {}),
  }
}

/** For tools combining several queries; see {@link runReadonlyQuery}. */
export function runReadonlyFetch<
  T extends FetchableData = Array<Record<string, unknown>>,
>(options: ReadonlyFetchOptions): Promise<FetchDataResult<T>> {
  return fetchData<T>(buildFetchArgs(options))
}

export async function runReadonlyQuery(
  query: string,
  hostId?: number,
  options: { query_params?: Record<string, unknown>; format?: DataFormat } = {}
): Promise<CallToolResult> {
  const result = await runReadonlyFetch({
    query,
    hostId,
    query_params: options.query_params,
    format: options.format,
  })

  if (result.error) {
    return toErrorResult(`Error: ${result.error.message}`)
  }

  return toJsonResult(result.data)
}

/**
 * Mirrors `MAX_QUERY_RESULT_ROWS` in the dashboard agent's tool helpers; kept in
 * sync manually since this package cannot import from `apps/*`.
 */
export const MAX_QUERY_RESULT_ROWS = 1000

/** Mirrors `capResultRows` in the dashboard agent's tool helpers. */
export function capResultRows<T>(
  data: T[],
  maxRows: number = MAX_QUERY_RESULT_ROWS
): { data: T[]; truncated: boolean } {
  if (!Array.isArray(data) || data.length <= maxRows) {
    return { data, truncated: false }
  }
  return { data: data.slice(0, maxRows), truncated: true }
}

export function truncationNote(
  maxRows: number = MAX_QUERY_RESULT_ROWS
): string {
  return `Results truncated to ${maxRows} rows. Add a LIMIT clause or aggregate the query to see the full result set.`
}
