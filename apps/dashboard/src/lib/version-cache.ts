/**
 * Version Cache Adapters
 *
 * Zero-config cache layer for ClickHouse version caching.
 * Auto-detects environment and uses appropriate caching strategy:
 * 1. Cloudflare Workers KV (if CHM_VERSION_CACHE_KV binding exists)
 * 2. In-memory fallback (always works — self-hosted Node/Docker, or
 *    Cloudflare before the KV namespace is provisioned)
 *
 * Registered as the L2 provider for
 * `@chm/clickhouse-client/clickhouse-version`'s per-isolate L1 cache from
 * `src/start.ts` (issue #2183) — that package can't import this file directly
 * (dependency-cruiser forbids `packages/` → `apps/`).
 *
 * Usage:
 * ```typescript
 * import { getVersionCache } from './version-cache'
 *
 * const cache = getVersionCache()
 * const version = await cache.get(hostId)
 * await cache.set(hostId, version, 3600)
 * ```
 */

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

import { debug, warn } from '@chm/logger'

/** The wrangler.toml binding name this module reads (see issue #2183). */
export const CHM_VERSION_CACHE_KV_BINDING = 'CHM_VERSION_CACHE_KV'

/**
 * Cache adapter interface
 */
export interface VersionCacheAdapter {
  get(hostId: number): Promise<ClickHouseVersion | null>
  set(
    hostId: number,
    version: ClickHouseVersion,
    ttlSeconds: number
  ): Promise<void>
}

/**
 * In-memory cache implementation (default fallback)
 */
export class InMemoryCache implements VersionCacheAdapter {
  private cache = new Map<
    number,
    { version: ClickHouseVersion; expires: number }
  >()

  async get(hostId: number): Promise<ClickHouseVersion | null> {
    const entry = this.cache.get(hostId)
    if (!entry || Date.now() > entry.expires) {
      return null
    }
    return entry.version
  }

  async set(
    hostId: number,
    version: ClickHouseVersion,
    ttlSeconds: number
  ): Promise<void> {
    this.cache.set(hostId, {
      version,
      expires: Date.now() + ttlSeconds * 1000,
    })
    debug(`[version-cache] In-memory cached version for host ${hostId}`)
  }
}

/**
 * Cloudflare Workers KV cache implementation
 */
export class CloudflareKVCache implements VersionCacheAdapter {
  private kv: KVNamespace

  constructor(binding: KVNamespace) {
    this.kv = binding
    debug('[version-cache] Using Cloudflare KV cache')
  }

  private getKey(hostId: number): string {
    return `ch-version:${hostId}`
  }

  async get(hostId: number): Promise<ClickHouseVersion | null> {
    try {
      const key = this.getKey(hostId)
      const value = await this.kv.get(key, { type: 'json' })
      if (!value) return null

      debug(`[version-cache] KV cache hit for host ${hostId}`)
      return value as ClickHouseVersion
    } catch (err) {
      warn('[version-cache] KV get error:', err)
      return null
    }
  }

  async set(
    hostId: number,
    version: ClickHouseVersion,
    ttlSeconds: number
  ): Promise<void> {
    try {
      const key = this.getKey(hostId)
      await this.kv.put(key, JSON.stringify(version), {
        expirationTtl: ttlSeconds,
      })
      debug(`[version-cache] KV cached version for host ${hostId}`)
    } catch (err) {
      warn('[version-cache] KV set error:', err)
    }
  }
}

/**
 * Singleton cache instance
 */
let cacheInstance: VersionCacheAdapter | null = null

/**
 * Get the appropriate cache adapter for the current environment
 *
 * Priority order:
 * 1. Cloudflare Workers KV (if CHM_VERSION_CACHE_KV binding exists)
 * 2. In-memory fallback
 *
 * @returns Cache adapter instance
 */
export function getVersionCache(kv?: KVNamespace | null): VersionCacheAdapter {
  if (cacheInstance) return cacheInstance

  // 1. Use the Cloudflare KV binding when the caller resolved one (null on
  // Node/self-hosted, or on Cloudflare before `[[kv_namespaces]]` is
  // provisioned). Resolving the binding is the caller's job (`start.ts`,
  // inside a `.server()` middleware body) — this module must not import
  // `cloudflare:workers` itself. TanStack Start splits code outside
  // `.server()` callbacks into an isomorphic chunk without that virtual
  // module, so importing it here breaks the build (#2183).
  if (kv) {
    try {
      cacheInstance = new CloudflareKVCache(kv)
      return cacheInstance
    } catch (err) {
      warn('[version-cache] Failed to initialize KV cache:', err)
    }
  }

  // 2. Fallback to in-memory
  debug('[version-cache] Using in-memory cache (fallback)')
  cacheInstance = new InMemoryCache()
  return cacheInstance
}

/**
 * Reset cache instance (useful for testing)
 */
export function resetCacheInstance(): void {
  cacheInstance = null
}
