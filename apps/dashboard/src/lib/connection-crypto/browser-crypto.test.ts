import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  __resetDeviceKeyPromiseForTest,
  decryptJson,
  encryptJson,
  getOrCreateDeviceKey,
} from './browser-crypto'

// Minimal in-memory IndexedDB stub — just enough for the device-key store
// (single object store, get/put by key). Requests resolve on a microtask, which
// is what opens the check-then-act race the single-flight guard must close.
function installFakeIndexedDB() {
  const data = new Map<string, unknown>()
  let generateCount = 0

  const fire = <T>(req: { onsuccess?: () => void; result: T }) => {
    queueMicrotask(() => req.onsuccess?.())
  }

  const store = {
    get(key: string) {
      const req: { onsuccess?: () => void; onerror?: () => void; result: unknown } = {
        result: data.has(key) ? data.get(key) : undefined,
      }
      fire(req)
      return req
    },
    put(value: unknown, key: string) {
      generateCount++
      const req: { onsuccess?: () => void; onerror?: () => void } = {}
      data.set(key, value)
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }

  const fakeIndexedDB = {
    open() {
      const req: {
        onupgradeneeded?: () => void
        onsuccess?: () => void
        onerror?: () => void
        result: unknown
      } = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => store,
          transaction: () => ({ objectStore: () => store }),
        },
      }
      queueMicrotask(() => {
        req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }

  ;(globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDB
  return {
    putCount: () => generateCount,
  }
}

describe('browser-crypto device key', () => {
  let harness: ReturnType<typeof installFakeIndexedDB>

  beforeEach(() => {
    __resetDeviceKeyPromiseForTest()
    harness = installFakeIndexedDB()
  })

  afterEach(() => {
    __resetDeviceKeyPromiseForTest()
  })

  it('single-flights concurrent creation onto one key (no first-run race)', async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateDeviceKey(),
      getOrCreateDeviceKey(),
      getOrCreateDeviceKey(),
    ])

    // Same CryptoKey instance for every concurrent caller...
    expect(a).toBe(b)
    expect(b).toBe(c)
    // ...and the key was persisted exactly once (no discarded key whose
    // ciphertext would become undecryptable).
    expect(harness.putCount()).toBe(1)
  })

  it('round-trips encrypt/decrypt with the shared key', async () => {
    const value = { host: 'https://ch.example:8443', user: 'default' }
    const encrypted = await encryptJson(value)
    expect(await decryptJson<typeof value>(encrypted)).toEqual(value)
  })
})
