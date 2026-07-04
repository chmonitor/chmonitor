import {
  getTableExistenceCache,
  resetTableExistenceCacheInstance,
} from './table-existence-kv-cache'
import { beforeEach, describe, expect, it } from 'bun:test'

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

describe('getTableExistenceCache — Node/self-hosted degradation (issue #2183)', () => {
  beforeEach(() => {
    resetTableExistenceCacheInstance()
  })

  it('degrades to a no-op when no KV binding is passed (Node/self-hosted path)', async () => {
    const cache = getTableExistenceCache(null)
    expect(await cache.get('0:system.backup_log')).toBeNull()
    await cache.set('0:system.backup_log', true, 300) // should not throw
    expect(await cache.get('0:system.backup_log')).toBeNull()
  })

  it('gets and sets through the injected KV binding', async () => {
    const { kv } = createFakeKv()
    const cache = getTableExistenceCache(kv)

    expect(await cache.get('0:system.backup_log')).toBeNull()
    await cache.set('0:system.backup_log', true, 300)
    expect(await cache.get('0:system.backup_log')).toBe(true)
  })

  it('writes with the given TTL under a namespaced key', async () => {
    const { kv, store } = createFakeKv()
    const cache = getTableExistenceCache(kv)
    await cache.set('0:system.backup_log', false, 300)
    expect(store.get('ch-table-exists:0:system.backup_log')).toEqual({
      value: 'false',
      expirationTtl: 300,
    })
  })

  it('memoizes the instance across calls', () => {
    const first = getTableExistenceCache(null)
    const second = getTableExistenceCache(createFakeKv().kv)
    expect(second).toBe(first)
  })
})
