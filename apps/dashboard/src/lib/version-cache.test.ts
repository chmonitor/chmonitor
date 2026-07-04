import {
  CloudflareKVCache,
  getVersionCache,
  InMemoryCache,
  resetCacheInstance,
} from './version-cache'
import { beforeEach, describe, expect, it } from 'bun:test'

const version1 = {
  major: 24,
  minor: 3,
  patch: 1,
  raw: '24.3.1',
}

function createFakeKv() {
  const store = new Map<string, { value: string; expirationTtl?: number }>()
  const kv = {
    get: async (key: string, _options?: { type?: string }) => {
      const entry = store.get(key)
      return entry ? JSON.parse(entry.value) : null
    },
    put: async (
      key: string,
      value: string,
      options?: { expirationTtl?: number }
    ) => {
      store.set(key, { value, expirationTtl: options?.expirationTtl })
    },
  } as unknown as KVNamespace
  return { kv, store }
}

describe('InMemoryCache', () => {
  it('returns null for a miss', async () => {
    const cache = new InMemoryCache()
    expect(await cache.get(0)).toBeNull()
  })

  it('stores and retrieves a version within the TTL', async () => {
    const cache = new InMemoryCache()
    await cache.set(0, version1, 3600)
    expect(await cache.get(0)).toEqual(version1)
  })

  it('expires an entry past its TTL', async () => {
    const cache = new InMemoryCache()
    await cache.set(0, version1, -1) // already expired
    expect(await cache.get(0)).toBeNull()
  })
})

describe('CloudflareKVCache', () => {
  it('gets and sets through the injected KV binding', async () => {
    const { kv } = createFakeKv()
    const cache = new CloudflareKVCache(kv)

    expect(await cache.get(0)).toBeNull()
    await cache.set(0, version1, 86400)
    expect(await cache.get(0)).toEqual(version1)
  })

  it('writes with the given TTL', async () => {
    const { kv, store } = createFakeKv()
    const cache = new CloudflareKVCache(kv)
    await cache.set(1, version1, 86400)
    expect(store.get('ch-version:1')?.expirationTtl).toBe(86400)
  })
})

describe('getVersionCache — Node/self-hosted degradation (issue #2183)', () => {
  beforeEach(() => {
    resetCacheInstance()
  })

  it('degrades to memory-only when no KV binding is passed (Node/self-hosted path)', async () => {
    const cache = getVersionCache(null)
    expect(cache).toBeInstanceOf(InMemoryCache)

    await cache.set(0, version1, 3600)
    expect(await cache.get(0)).toEqual(version1)
  })

  it('uses the KV adapter when a binding is passed (Cloudflare path)', async () => {
    const { kv } = createFakeKv()
    const cache = getVersionCache(kv)
    expect(cache).toBeInstanceOf(CloudflareKVCache)
  })

  it('memoizes the instance across calls', () => {
    const first = getVersionCache(null)
    const second = getVersionCache(createFakeKv().kv)
    expect(second).toBe(first)
  })
})
