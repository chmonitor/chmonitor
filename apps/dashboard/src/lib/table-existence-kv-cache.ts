/**
 * L2 cache adapter for the table-existence check (issue #2183).
 *
 * `@chm/clickhouse-client/table-existence-cache` keeps a per-isolate LRU (5min
 * TTL) guarding optional system tables (`system.backup_log`,
 * `system.zookeeper`, …). On Cloudflare that cache is wiped on every Worker
 * isolate churn, forcing a fresh `SELECT count() FROM system.tables` per cold
 * start. This adapter backs it with the same `VERSION_CACHE_KV` namespace
 * used by `version-cache.ts` (different key prefix, same binding — a table's
 * existence rarely changes, so one small KV namespace covers both caches),
 * and is registered as that package's L2 provider from `src/start.ts`.
 *
 * Degrades to a no-op (`get` → null, `set` → no-op) when the binding is
 * unbound — self-hosted Docker/K8s, Node build, or Cloudflare before
 * `[[kv_namespaces]]` is provisioned — so the in-memory LRU keeps working
 * standalone everywhere this adapter can't reach KV.
 */

import { debug, warn } from '@chm/logger'

export interface TableExistenceCacheAdapter {
  get(key: string): Promise<boolean | null>
  set(key: string, exists: boolean, ttlSeconds: number): Promise<void>
}

function kvKey(key: string): string {
  return `ch-table-exists:${key}`
}

class KVTableExistenceCache implements TableExistenceCacheAdapter {
  constructor(private readonly kv: KVNamespace | null) {}

  async get(key: string): Promise<boolean | null> {
    if (!this.kv) return null

    try {
      const value = await this.kv.get(kvKey(key), { type: 'json' })
      if (typeof value !== 'boolean') return null
      debug(`[table-existence-kv-cache] KV cache hit for ${key}`)
      return value
    } catch (err) {
      warn('[table-existence-kv-cache] KV get error:', err)
      return null
    }
  }

  async set(key: string, exists: boolean, ttlSeconds: number): Promise<void> {
    if (!this.kv) return

    try {
      await this.kv.put(kvKey(key), JSON.stringify(exists), {
        expirationTtl: ttlSeconds,
      })
    } catch (err) {
      warn('[table-existence-kv-cache] KV set error:', err)
    }
  }
}

let cacheInstance: TableExistenceCacheAdapter | null = null

/**
 * Get the table-existence L2 cache adapter. Safe to call unconditionally —
 * every method degrades to a no-op when the caller passes a null/undefined
 * `kv` (Node/self-hosted, or Cloudflare before `[[kv_namespaces]]` is
 * provisioned). Resolving the binding is the caller's job (`start.ts`) — this
 * module must not import `cloudflare:workers` itself (#2183).
 */
export function getTableExistenceCache(
  kv?: KVNamespace | null
): TableExistenceCacheAdapter {
  if (!cacheInstance) {
    cacheInstance = new KVTableExistenceCache(kv ?? null)
  }
  return cacheInstance
}

/** Reset the cache instance (tests only). */
export function resetTableExistenceCacheInstance(): void {
  cacheInstance = null
}
