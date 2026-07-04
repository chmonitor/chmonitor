/**
 * Unit tests for the `caches.default` wrapper (#2181).
 *
 * `isAnonymousPublicReadRequest` (the actual isSignedIn/public-read
 * resolution) is mocked here so these tests can focus purely on the
 * cache-key/match/put mechanics; the safety-critical "an authenticated
 * request is never cached" invariant is covered end-to-end at the route
 * level in routes/api/v1/charts/__tests__/name-edge-cache.test.ts, which
 * exercises the real auth resolution instead of mocking it away.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let anonymousPublicRead = true
mock.module('@/lib/feature-permissions/server', () => ({
  isAnonymousPublicReadRequest: async () => anonymousPublicRead,
}))

const { buildEdgeCacheKey, isEdgeCacheEligible, matchEdgeCache, putEdgeCache } =
  await import('../edge-cache')

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/charts/foo?hostId=0')
}

describe('isEdgeCacheEligible', () => {
  test('delegates to isAnonymousPublicReadRequest', async () => {
    anonymousPublicRead = true
    expect(await isEdgeCacheEligible(makeRequest())).toBe(true)

    anonymousPublicRead = false
    expect(await isEdgeCacheEligible(makeRequest())).toBe(false)
  })
})

describe('buildEdgeCacheKey', () => {
  test('normalizes param order so equivalent requests share a cache entry', () => {
    const a = buildEdgeCacheKey('charts', { name: 'foo', hostId: 0, x: 'a' })
    const b = buildEdgeCacheKey('charts', { hostId: 0, x: 'a', name: 'foo' })
    expect(a.url).toBe(b.url)
  })

  test('omits undefined parts', () => {
    const key = buildEdgeCacheKey('charts', {
      name: 'foo',
      interval: undefined,
    })
    expect(key.url).not.toContain('interval')
  })

  test('namespaces by route so different endpoints never collide', () => {
    const a = buildEdgeCacheKey('charts', { name: 'foo' })
    const b = buildEdgeCacheKey('data', { name: 'foo' })
    expect(a.url).not.toBe(b.url)
  })
})

describe('matchEdgeCache / putEdgeCache', () => {
  beforeEach(() => {
    delete (globalThis as { caches?: unknown }).caches
  })

  test('no-ops (never throws) when caches.default is unavailable (tests/Node)', async () => {
    const key = buildEdgeCacheKey('charts', { name: 'foo' })
    await expect(matchEdgeCache(key)).resolves.toBeUndefined()
    await expect(
      putEdgeCache(key, new Response('{}', { status: 200 }))
    ).resolves.toBeUndefined()
  })

  test('put() skips a non-200 response', async () => {
    const put = mock(async () => undefined)
    ;(globalThis as { caches?: unknown }).caches = {
      default: { put, match: mock(async () => undefined) },
    }
    const key = buildEdgeCacheKey('charts', { name: 'foo' })
    await putEdgeCache(
      key,
      new Response('{}', {
        status: 500,
        headers: { 'Cache-Control': 'public, s-maxage=30' },
      })
    )
    expect(put).not.toHaveBeenCalled()
  })

  test('put() skips a response with no s-maxage directive', async () => {
    const put = mock(async () => undefined)
    ;(globalThis as { caches?: unknown }).caches = {
      default: { put, match: mock(async () => undefined) },
    }
    const key = buildEdgeCacheKey('charts', { name: 'foo' })
    await putEdgeCache(
      key,
      new Response('{}', {
        status: 200,
        headers: { 'Cache-Control': 'private, max-age=0' },
      })
    )
    expect(put).not.toHaveBeenCalled()
  })

  test('put() stores a cacheable 200 response', async () => {
    const put = mock(async () => undefined)
    ;(globalThis as { caches?: unknown }).caches = {
      default: { put, match: mock(async () => undefined) },
    }
    const key = buildEdgeCacheKey('charts', { name: 'foo' })
    const response = new Response('{}', {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    })
    await putEdgeCache(key, response)
    expect(put).toHaveBeenCalledTimes(1)
    // The caller's response object must stay usable (not consumed by put()).
    expect(response.bodyUsed).toBe(false)
  })

  test('match() returns the cache hit', async () => {
    const cached = new Response('{"cached":true}')
    const match = mock(async () => cached)
    ;(globalThis as { caches?: unknown }).caches = {
      default: { put: mock(async () => undefined), match },
    }
    const key = buildEdgeCacheKey('charts', { name: 'foo' })
    expect(await matchEdgeCache(key)).toBe(cached)
  })
})
