import type { DataFormat } from '@clickhouse/client'

import type { FetchDataResult } from '@chm/clickhouse-client'
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'

import { fetchData } from '@chm/clickhouse-client'
import { z } from 'zod/v3'

/**
 * Shared Zod schema for the optional `hostId` argument used by every tool.
 * Selects which configured ClickHouse host to query (default: index 0).
 */
export const hostIdSchema = z
  .number()
  .optional()
  .describe('Host index (default: 0)')

/**
 * Shared MCP tool annotations for every tool registered by this package.
 *
 * Every tool executes exactly one thing: a ClickHouse query run through
 * {@link runReadonlyFetch} / {@link runReadonlyQuery}, which force
 * `clickhouse_settings.readonly = '1'` (see `buildFetchArgs` below). That
 * makes the four hints uniform across the whole server, not just a default:
 * - `readOnlyHint: true` — never writes, matching the enforced `readonly`
 *   ClickHouse setting.
 * - `destructiveHint: false` — meaningless once `readOnlyHint` is true, but
 *   set explicitly so clients that don't special-case read-only tools still
 *   see the correct (non-destructive) signal.
 * - `idempotentHint: true` — a read has no side effects, so repeating the
 *   same call never has "additional effect" beyond the first (the MCP
 *   definition of idempotent) — true even for the freeform `query` tool,
 *   since `validateSqlQuery` restricts it to SELECT/WITH.
 * - `openWorldHint: false` — every tool talks only to the operator's own
 *   configured ClickHouse host(s) (`hostId` selects among them), a closed,
 *   known set of systems — never the open web or arbitrary external
 *   services.
 *
 * Spread this into each `server.tool(...)` call and add a tool-specific
 * `title` so every registration stays in sync (see #2703).
 */
export const READONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** Build an error result envelope with the given (already-formatted) message. */
export function toErrorResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  }
}

/** Build a success result envelope from data serialized as pretty JSON. */
export function toJsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
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

/**
 * Run a read-only ClickHouse query and return the raw fetch result.
 *
 * Applies the shared boilerplate used by every MCP tool: `format` defaults to
 * `JSONEachRow`, `clickhouse_settings.readonly` is forced to `'1'`, and
 * `hostId` defaults to `0`. Use this when a tool needs to combine several
 * queries; use {@link runReadonlyQuery} for the common single-query case.
 */
export function runReadonlyFetch<
  T extends FetchableData = Array<Record<string, unknown>>,
>(options: ReadonlyFetchOptions): Promise<FetchDataResult<T>> {
  return fetchData<T>(buildFetchArgs(options))
}

/**
 * Run a single read-only ClickHouse query and map it to the MCP result
 * envelope: on error, `{ isError: true }` with `Error: <message>`; otherwise the
 * pretty-printed JSON rows.
 */
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
 * Max rows returned to the model by the standalone MCP server's freeform
 * `query` tool. Mirrors
 * `apps/dashboard/src/lib/ai/agent/tools/helpers.ts` (`MAX_QUERY_RESULT_ROWS`)
 * — kept in sync manually since this package cannot import from `apps/*`.
 */
export const MAX_QUERY_RESULT_ROWS = 1000

/**
 * Cap an array of query result rows to `maxRows`, flagging truncation so the
 * caller can surface a visible note to the model instead of silently
 * dropping rows. Mirrors `capResultRows` in the dashboard agent's tool
 * helpers.
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
 * Human-readable note explaining a truncated result set.
 */
export function truncationNote(
  maxRows: number = MAX_QUERY_RESULT_ROWS
): string {
  return `Results truncated to ${maxRows} rows. Add a LIMIT clause or aggregate the query to see the full result set.`
}
