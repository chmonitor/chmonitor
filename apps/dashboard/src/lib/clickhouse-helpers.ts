import type { DataFormat, QueryParams } from '@clickhouse/client'

import type { FetchDataResult } from '@chm/clickhouse-client'
import type { QueryConfig } from '@/types/query-config'

import { fetchData } from '@chm/clickhouse-client'
import { ErrorLogger } from '@chm/logger'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'

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
    // null/undefined/'' mean "unset" → default host 0. Anything else must be a
    // whole, non-negative number (no fractions, no trailing junk).
    const finalHostId =
      hostId == null || hostId === '' ? 0 : parseHostIdParam(hostId)
    if (!(finalHostId >= 0)) {
      throw new Error(`Invalid hostId: ${String(hostId)}`)
    }

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
