interface CacheEntry {
  readonly queries: Set<string>
  readonly timestamp: number
}

const cache = new Map<string, CacheEntry>()

let cacheTimestamp = 0

const DEFAULT_CACHE_TTL = 5 * 60 * 1000

const currentCacheTTL = DEFAULT_CACHE_TTL

export function getCacheTTL(): number {
  return currentCacheTTL
}

function isCacheExpired(): boolean {
  const now = Date.now()
  return now - cacheTimestamp > currentCacheTTL
}

function clearExpiredCache(): void {
  if (isCacheExpired()) {
    cache.clear()
    cacheTimestamp = Date.now()
  }
}

export function getCachedDashboardQueries(
  hostId: number
): Set<string> | undefined {
  clearExpiredCache()

  const cacheKey = String(hostId)
  const entry = cache.get(cacheKey)

  return entry?.queries
}

export function updateDashboardQueryCache(
  hostId: number,
  queries: Set<string>
): void {
  const cacheKey = String(hostId)

  cache.set(cacheKey, {
    queries: new Set(queries), // Create a copy to prevent external mutation
    timestamp: Date.now(),
  })
}

export function clearHostCache(hostId: number): void {
  const cacheKey = String(hostId)
  cache.delete(cacheKey)
}

export function getCacheStats(): {
  readonly entryCount: number
  readonly ttl: number
  readonly lastClear: number
  readonly entries: ReadonlyArray<{
    readonly hostId: string
    readonly queryCount: number
  }>
} {
  return {
    entryCount: cache.size,
    ttl: currentCacheTTL,
    lastClear: cacheTimestamp,
    entries: Array.from(cache.entries()).map(([hostId, entry]) => ({
      hostId,
      queryCount: entry.queries.size,
    })),
  }
}
