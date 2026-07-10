import type { QueryCacheAdapter } from './types'

import { MemoryCacheAdapter } from './adapters/memory-cache'
import { debug } from '@chm/logger'

export const CLICKHOUSE_CACHE_TAG = 'clickhouse_results'

export type { CacheOptions, QueryCacheAdapter } from './types'

let cacheInstance: QueryCacheAdapter | null = null
let memoryCacheInstance: MemoryCacheAdapter | null = null

export function getQueryCache(): QueryCacheAdapter {
  if (cacheInstance) return cacheInstance

  debug('[query-cache] Initializing query cache adapter')
  cacheInstance = new MemoryCacheAdapter()
  return cacheInstance
}

export function getMemoryCache(): QueryCacheAdapter {
  if (memoryCacheInstance) return memoryCacheInstance
  memoryCacheInstance = new MemoryCacheAdapter()
  return memoryCacheInstance
}

export function resetQueryCacheInstance(): void {
  cacheInstance?.dispose?.()
  cacheInstance = null
}

export function resetMemoryCacheInstance(): void {
  memoryCacheInstance?.dispose?.()
  memoryCacheInstance = null
}
