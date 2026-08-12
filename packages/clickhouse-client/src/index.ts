/**
 * ClickHouse Client Module
 *
 * This file now serves as a central re-export point for all ClickHouse-related modules.
 * The ClickHouse client functionality has been split into domain modules for better organization:
 *
 * - types: Shared types for ClickHouse client and data fetching
 * - connection-pool: Connection pooling and management
 * - clickhouse-config: Configuration parsing from environment variables
 * - clickhouse-client: Client factory with auto-detection for Cloudflare Workers
 * - clickhouse-fetch: Main fetchData function with comprehensive error handling
 * - constants: Shared constants like query comments and timeouts
 */

import type { FetchDataResult } from './clickhouse/types'

// Re-export connection pool utilities (if needed externally)
export type { PooledClient } from './clickhouse/connection-pool'
// Re-export all types
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

// Re-export client factory
export {
  getClient,
  getConnectionPoolStats,
  isCloudflareWorkers,
  releaseClient,
} from './clickhouse/clickhouse-client'
// Re-export configuration functions
export {
  getAndValidateClientConfig,
  getClickHouseConfigs,
  getClickHouseHosts,
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
// Re-export constants
export {
  DEFAULT_CLICKHOUSE_MAX_EXECUTION_TIME,
  QUERY_COMMENT,
} from './clickhouse/constants'
