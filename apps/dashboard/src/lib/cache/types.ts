export interface CacheOptions {
  key?: string[]
  tags?: string[]
  ttlSeconds?: number
}

export interface QueryCacheAdapter {
  wrap<T>(fn: () => Promise<T>, options: CacheOptions): Promise<T>
  /** Release any adapter-owned resources (e.g. a cleanup interval timer). */
  dispose?(): void
}
