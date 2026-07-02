import type { DataFormat } from '@clickhouse/client'

import type { FetchDataResult } from '@chm/clickhouse-client'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

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
