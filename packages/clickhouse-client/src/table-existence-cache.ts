import { getClient } from './clickhouse/clickhouse-client'
import { debug, error } from '@chm/logger'
import { LRUCache } from 'lru-cache'

/**
 * Cache configuration with memory limits
 * - max: 500 entries (reduced from 1000)
 * - maxSize: 1MB total memory limit
 * - TTL: 5 minutes
 */
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const cache = new LRUCache<string, boolean>({
  ttl: CACHE_TTL_MS,
  max: 500, // Reduced from 1000 for memory efficiency
  maxSize: 1024 * 1024, // 1MB total cache size limit
  sizeCalculation: () => 1, // Each entry counts as 1 unit (simplified size tracking)
  dispose: (value: boolean, key: string) => {
    debug(`[Table Cache] Evicted: ${key} = ${value}`)
  },
})

/**
 * L2 cache contract for `checkTableExists` (issue #2183) — survives Worker
 * isolate churn, unlike the per-isolate LRU above.
 *
 * This package must not import `apps/dashboard` (dependency-cruiser
 * `no-packages-to-apps`), so the KV-backed implementation lives app-side
 * (`apps/dashboard/src/lib/table-existence-kv-cache.ts`) and is injected here
 * via `setTableExistenceL2Provider`, registered once from `src/start.ts`. When
 * no provider is registered (self-hosted Node/Docker path), this is a pure
 * no-op and `checkTableExists` behaves exactly as before — L1-LRU-only.
 */
export interface TableExistenceCacheL2 {
  get(key: string): Promise<boolean | null>
  set(key: string, exists: boolean, ttlSeconds: number): Promise<void>
}

let l2CacheProvider: (() => TableExistenceCacheL2 | null) | null = null

/**
 * Register (or clear, with `null`) the L2 cache provider — see
 * `setVersionCacheL2Provider` in `clickhouse-version.ts` for the same pattern.
 */
export function setTableExistenceL2Provider(
  provider: (() => TableExistenceCacheL2 | null) | null
): void {
  l2CacheProvider = provider
}

export async function checkTableExists(
  hostId: number,
  database: string,
  table: string
): Promise<boolean> {
  const key = `${hostId}:${database}.${table}`
  const cached = cache.get(key)
  if (cached !== undefined) {
    return cached
  }

  // L2: KV cache (survives Worker isolate churn). No-op when no provider is
  // registered (self-hosted Node/Docker, or Cloudflare before the KV
  // namespace is provisioned — see #2183).
  const l2 = l2CacheProvider?.()
  if (l2) {
    try {
      const l2Exists = await l2.get(key)
      if (l2Exists !== null) {
        cache.set(key, l2Exists)
        debug(`[Table Cache] L2 (KV) cache hit for ${key}`)
        return l2Exists
      }
    } catch (err) {
      error('[Table Cache] L2 cache get error:', err)
    }
  }

  try {
    // getClient will auto-detect and use web client for Cloudflare Workers
    const client = await getClient({ hostId })
    const result = await client.query({
      query: `
        SELECT COUNT() AS count
        FROM system.tables
        WHERE database = {database:String}
          AND name     = {table:String}
      `,
      query_params: { database, table },
      format: 'JSONEachRow',
    })
    const data = (await result.json()) as { count: string }[]
    const exists = parseInt(data?.[0]?.count || '0', 10) > 0

    cache.set(key, exists)
    if (l2) {
      try {
        await l2.set(key, exists, CACHE_TTL_MS / 1000)
      } catch (err) {
        error('[Table Cache] L2 cache set error:', err)
      }
    }
    return exists
  } catch (err) {
    error(`Error checking table ${database}.${table}:`, err)
    return false
  }
}

/**
 * Get cache metrics for monitoring and debugging
 */
export function getCacheMetrics() {
  return {
    size: cache.size,
    maxSize: cache.max,
    memoryLimit: '1MB',
    ttl: '5 minutes',
    hitRate: cache.size > 0 ? 'available' : 'empty',
  }
}

/**
 * Manual cache invalidation
 */
export const invalidateTable = (
  hostId: number,
  database: string,
  table: string
) => {
  cache.delete(`${hostId}:${database}.${table}`)
}

/**
 * Clear entire cache
 */
export const clearTableCache = () => cache.clear()

/**
 * Get current cache size
 */
export const tableCacheSize = () => cache.size

// Keep the old interface for backward compatibility
export const tableExistenceCache = {
  checkTableExists,
  invalidate: invalidateTable,
  clear: clearTableCache,
  getCacheSize: tableCacheSize,
  getMetrics: getCacheMetrics,
}
