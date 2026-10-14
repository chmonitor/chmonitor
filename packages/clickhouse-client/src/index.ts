
import type { FetchDataResult } from './clickhouse/types'

export type { PooledClient } from './clickhouse/connection-pool'
export type {
  ClickHouseConfig,
  FetchDataError,
  FetchDataErrorType,
  FetchDataResult,
} from './clickhouse/types'

type ClickHouseFetchModule = typeof import('./clickhouse/clickhouse-fetch')

let clickhouseFetchModulePromise: Promise<ClickHouseFetchModule> | null = null

async function loadClickhouseFetchModule(): Promise<ClickHouseFetchModule> {
  if (!clickhouseFetchModulePromise) {
    clickhouseFetchModulePromise = import('./clickhouse/clickhouse-fetch')
  }

  return clickhouseFetchModulePromise
}

export {
  getClient,
  getConnectionPoolStats,
  isCloudflareWorkers,
  releaseClient,
} from './clickhouse/clickhouse-client'
export {
  getAndValidateClientConfig,
  getClickHouseConfigs,
  getClickHouseHosts,
  redactHostCredentials,
} from './clickhouse/clickhouse-config'
// Re-export data fetching functions without eagerly loading the module.
export async function fetchData<
  T extends
    | unknown[]
    | object[]
    | Record<string, unknown>
    | { length: number; rows: number; statistics: Record<string, unknown> },
>(
  ...args: Parameters<ClickHouseFetchModule['fetchData']>
): Promise<FetchDataResult<T>> {
  const { fetchData } = await loadClickhouseFetchModule()
  return fetchData<T>(...args)
}

export async function fetchJsonEachRowAsNormalizedJson(
  ...args: Parameters<ClickHouseFetchModule['fetchJsonEachRowAsNormalizedJson']>
): ReturnType<ClickHouseFetchModule['fetchJsonEachRowAsNormalizedJson']> {
  const { fetchJsonEachRowAsNormalizedJson } = await loadClickhouseFetchModule()
  return fetchJsonEachRowAsNormalizedJson(...args)
}

export {
  cleanupStaleClients,
  getPooledClient,
  getPoolKey,
} from './clickhouse/connection-pool'
export {
  DEFAULT_CLICKHOUSE_MAX_EXECUTION_TIME,
  QUERY_COMMENT,
} from './clickhouse/constants'
