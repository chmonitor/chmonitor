import { QueryClient } from '@tanstack/react-query'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
} from '@/lib/types/user-settings'

// Count backend hits without a network stack. `resolveUserSettings` only ever
// reaches the backend through `apiFetch`, so this is the whole surface.
let backendCalls = 0
let backendParams: Record<string, string> = {}

mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: async () => {
    backendCalls += 1
    return {
      ok: true,
      json: async () => ({ success: true, data: { params: backendParams } }),
    }
  },
}))

// Minimal localStorage/window fakes — the test runner has no DOM (see
// src/lib/utils/clipboard.test.ts for the same approach).
function installStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  ;(globalThis as { window?: unknown }).window = { localStorage: storage }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return store
}

const { USER_SETTINGS_QUERY_KEY, resolveUserSettings } = await import(
  './use-user-settings'
)

beforeEach(() => {
  backendCalls = 0
  backendParams = {}
})

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = undefined
  ;(globalThis as { localStorage?: unknown }).localStorage = undefined
})

describe('resolveUserSettings', () => {
  test('locally stored settings win and never hit the backend', async () => {
    installStorage({
      [USER_SETTINGS_STORAGE_KEY]: JSON.stringify({ timezone: 'Asia/Bangkok' }),
    })

    const settings = await resolveUserSettings()

    expect(settings.timezone).toBe('Asia/Bangkok')
    // A returning user must not pay for a settings round-trip on every load.
    expect(backendCalls).toBe(0)
  })

  test('first run with no stored settings adopts backend defaults', async () => {
    const store = installStorage()
    backendParams = { timezone: 'Europe/Berlin', theme: 'dark' }

    const settings = await resolveUserSettings()

    expect(settings.timezone).toBe('Europe/Berlin')
    expect(settings.theme).toBe('dark')
    expect(backendCalls).toBe(1)
    // Persisted, so the next load is a cache hit rather than another fetch.
    expect(store.has(USER_SETTINGS_STORAGE_KEY)).toBe(true)
  })

  test('a partial stored blob is merged over the defaults', async () => {
    installStorage({
      [USER_SETTINGS_STORAGE_KEY]: JSON.stringify({ tableDensity: 'compact' }),
    })

    const settings = await resolveUserSettings()

    expect(settings.tableDensity).toBe('compact')
    expect(settings.byteUnit).toBe(DEFAULT_USER_SETTINGS.byteUnit)
  })
})

describe('user-settings query key', () => {
  // This is the regression guard for #2984. Before the fix each consumer ran
  // its own useEffect + apiFetch, so a page whose nav renders `useUserSettings`
  // once per menu entry fired 8-16 concurrent requests for the same data.
  // Resolving under ONE shared key is what collapses that to a single fetch, so
  // the property under test is "N concurrent consumers => 1 backend call".
  test('concurrent consumers sharing the key trigger exactly one fetch', async () => {
    installStorage()
    const client = new QueryClient()

    const consumers = Array.from({ length: 16 }, () =>
      client.fetchQuery({
        queryKey: USER_SETTINGS_QUERY_KEY,
        queryFn: resolveUserSettings,
        staleTime: Number.POSITIVE_INFINITY,
      })
    )
    const results = await Promise.all(consumers)

    expect(backendCalls).toBe(1)
    // Every consumer sees the same resolved object, not 16 divergent copies.
    for (const r of results) expect(r).toEqual(results[0])
  })

  test('a later consumer reuses the cached settings instead of refetching', async () => {
    installStorage()
    const client = new QueryClient()
    const fetchOnce = () =>
      client.fetchQuery({
        queryKey: USER_SETTINGS_QUERY_KEY,
        queryFn: resolveUserSettings,
        staleTime: Number.POSITIVE_INFINITY,
      })

    await fetchOnce()
    await fetchOnce()

    expect(backendCalls).toBe(1)
  })
})
