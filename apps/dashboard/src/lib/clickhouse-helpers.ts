import type { DataFormat, QueryParams } from '@clickhouse/client'

import type { FetchDataResult } from '@chm/clickhouse-client'
import type { QueryConfig } from '@/types/query-config'

import { fetchData } from '@chm/clickhouse-client'
import { ErrorLogger } from '@chm/logger'

type QuerySettings = QueryParams['clickhouse_settings'] &
  Partial<{
    query_cache_system_table_handling: 'throw' | 'save' | 'ignore'
    query_cache_nondeterministic_function_handling: 'throw' | 'save' | 'ignore'
  }>

export async function fetchDataWithHost<
  T extends
    | unknown[]
    | object[]
    | Record<string, unknown>
    | { length: number; rows: number; statistics: Record<string, unknown> },
>({
  query,
  query_params,
  format = 'JSONEachRow' as DataFormat,
  clickhouse_settings,
  queryConfig,
  hostId = 0,
}: Omit<QueryParams, 'format'> & {
  format?: DataFormat
  clickhouse_settings?: QuerySettings
  queryConfig?: QueryConfig
  hostId?: number | string
}): Promise<FetchDataResult<T>> {
  try {
    const finalHostId = validateHostId(hostId)

    return await fetchData<T>({
      query,
      query_params,
      format,
      clickhouse_settings,
      queryConfig,
      hostId: finalHostId,
    })
  } catch (error) {
    ErrorLogger.logError(error as Error, { component: 'fetchDataWithHost' })

    return {
      data: null,
      metadata: {
        queryId: '',
        duration: 0,
        rows: 0,
        host: 'unknown',
      },
      error: {
        type: 'query_error',
        message:
          error instanceof Error ? error.message : 'An unknown error occurred',
        details: {
          originalError:
            error instanceof Error ? error : new Error(String(error)),
        },
      },
    }
  }
}

export function validateHostId(hostId: unknown): number {
  if (hostId === undefined || hostId === null) {
    return 0
  }

  if (typeof hostId === 'string') {
    const trimmed = hostId.trim()
    // Empty/whitespace-only is treated as "missing" (like undefined/null),
    // not malformed — callers may pass through an unset form field this way.
    if (trimmed === '') {
      return 0
    }
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10)
    }
    throw new Error(`Invalid hostId: ${hostId}`)
  }

  if (typeof hostId === 'number') {
    if (Number.isInteger(hostId) && hostId >= 0) {
      return hostId
    }
    throw new Error(`Invalid hostId: ${hostId}`)
  }

  throw new Error(`Invalid hostId: ${String(hostId)}`)
}
