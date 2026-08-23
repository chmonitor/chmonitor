/**
 * Tests for the in-memory token bucket rate limiter.
 *
 * Covers:
 *  - Requests within the limit are allowed
 *  - Requests exceeding the limit are rejected with retryAfterSec
 *  - Bucket refills over time
 *  - rateLimitResponse returns a 429 with Retry-After
 *  - clientIpKey extraction from various headers
 *  - Bucket store stays bounded and evicts old entries under high cardinality
 */

import type { RateLimitBinding } from '../rate-limiter'

import {
  _bucketCountForTest,
  _MAX_BUCKETS_FOR_TEST,
  _resetBucketsForTest,
  checkRateLimit,
  checkRateLimitDurable,
  clientIpKey,
  getRateLimitBinding,
  rateLimitResponse,
  trustProxyHeaders,
} from '../rate-limiter'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

afterEach(() => {
  _resetBucketsForTest()
})

describe('checkRateLimit', () => {
  test('allows requests within the limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit('test-key', 5)
      expect(result.allowed).toBe(true)
    }
  })

  test('rejects the request that exceeds the limit', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('burst-key', 5)
    }
    const result = checkRateLimit('burst-key', 5)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSec).toBeGreaterThan(0)
    expect(result.remaining).toBe(0)
  })

  test('separate bucket keys are independent', () => {
    // Exhaust key-a
    for (let i = 0; i < 3; i++) checkRateLimit('key-a', 3)
    expect(checkRateLimit('key-a', 3).allowed).toBe(false)

    // key-b is untouched
    expect(checkRateLimit('key-b', 3).allowed).toBe(true)
  })

  test('remaining decreases with each call', () => {
    const r1 = checkRateLimit('decr-key', 10)
    const r2 = checkRateLimit('decr-key', 10)
    expect(r1.remaining).toBeGreaterThan(r2.remaining)
  })

  test('returns retryAfterSec > 0 when rejected', () => {
    for (let i = 0; i < 2; i++) checkRateLimit('retry-key', 2)
    const result = checkRateLimit('retry-key', 2)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  test('limit=1 allows exactly one request', () => {
    expect(checkRateLimit('tight-key', 1).allowed).toBe(true)
    expect(checkRateLimit('tight-key', 1).allowed).toBe(false)
  })

  test('bucket store stays bounded and evicts oldest entries past the cap', () => {
    const cap = _MAX_BUCKETS_FOR_TEST
    for (let i = 0; i < cap + 50; i++) {
      checkRateLimit(`bounded-key-${i}`, 5)
    }
    expect(_bucketCountForTest()).toBeLessThanOrEqual(cap)
    // The earliest keys should have been evicted (oldest-first eviction).
    expect(checkRateLimit('bounded-key-0', 5).remaining).toBe(4)
  })
})

describe('rateLimitResponse', () => {
  test('returns 429 status', () => {
    const response = rateLimitResponse(30)
    expect(response.status).toBe(429)
  })

  test('sets Retry-After header', async () => {
    const response = rateLimitResponse(15)
    expect(response.headers.get('Retry-After')).toBe('15')
  })

  test('body contains retryAfterSec', async () => {
    const response = rateLimitResponse(42)
    const body = (await response.json()) as {
      success: boolean
      error: { type: string; retryAfterSec: number }
    }
    expect(body.error.retryAfterSec).toBe(42)
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('rate_limited')
  })
})

describe('clientIpKey', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers })
  }

  test('prefers CF-Connecting-IP', () => {
    const req = makeRequest({
      'cf-connecting-ip': '1.2.3.4',
      'x-real-ip': '5.6.7.8',
    })
    expect(clientIpKey(req)).toBe('1.2.3.4')
  })

  test('CF-Connecting-IP is always trusted even when proxy headers are not', () => {
    // CF-Connecting-IP is set/stripped by the Workers edge itself, so it is never
    // spoofable — it must win even with the default (untrusted) proxy policy.
    const req = makeRequest({ 'cf-connecting-ip': '1.2.3.4' })
    expect(clientIpKey(req)).toBe('1.2.3.4')
  })

  test('returns "unknown" when no IP headers present', () => {
    const req = makeRequest({})
    expect(clientIpKey(req)).toBe('unknown')
  })

  // WHY: on self-hosted (Node/Docker/K8s) X-Real-IP and X-Forwarded-For are
  // client-supplied unless the operator's ingress rewrites them. Trusting them
  // lets a caller rotate headers per request to bypass IP-keyed limiters and,
  // for Cloud guests, to mint a fresh `guest:<hash>` daily-quota identity each
  // time — defeating the guest AI quota (the core of issue #3225). Off by
  // default on non-Cloudflare runtimes so the OSS build is never weakened.
  describe('untrusted proxy headers (self-hosted default)', () => {
    const NODE_ENV: Record<string, string | undefined> = {} // no Cloudflare markers

    test('ignores spoofed X-Real-IP', () => {
      const req = makeRequest({ 'x-real-ip': '9.10.11.12' })
      expect(clientIpKey(req, NODE_ENV)).toBe('unknown')
    })

    test('ignores spoofed X-Forwarded-For', () => {
      const req = makeRequest({
        'x-forwarded-for': '13.14.15.16, 17.18.19.20',
      })
      expect(clientIpKey(req, NODE_ENV)).toBe('unknown')
    })

    test('spoofed headers cannot reset the guest quota identity', () => {
      // Same key the agent route keys its bucket on — rotation must NOT change it.
      const req = makeRequest({ 'x-forwarded-for': '8.8.8.8' })
      expect(clientIpKey(req, NODE_ENV)).toBe('unknown')
      const req2 = makeRequest({ 'x-forwarded-for': '8.8.4.4' })
      expect(clientIpKey(req2, NODE_ENV)).toBe('unknown')
    })
  })

  // WHY: on the Cloudflare Workers runtime the edge sets and sanitises
  // CF-Connecting-IP and strips inbound proxy headers for us, so the spoof
  // vector is closed at the platform — those headers may be trusted there.
  describe('trusted proxy headers (Cloudflare runtime / CHM_TRUST_PROXY_HEADERS)', () => {
    test('honours CHM_TRUST_PROXY_HEADERS=true on a Node runtime', () => {
      const req = makeRequest({ 'x-real-ip': '9.10.11.12' })
      expect(clientIpKey(req, { CHM_TRUST_PROXY_HEADERS: 'true' })).toBe(
        '9.10.11.12'
      )
    })

    test('honours CHM_TRUST_PROXY_HEADERS=true for X-Forwarded-For', () => {
      const req = makeRequest({
        'x-forwarded-for': '13.14.15.16, 17.18.19.20',
      })
      expect(clientIpKey(req, { CHM_TRUST_PROXY_HEADERS: 'true' })).toBe(
        '13.14.15.16'
      )
    })

    test('defaults to trusting proxy headers when CLOUDFLARE_WORKERS=1 (edge)', () => {
      const req = makeRequest({
        'x-real-ip': '9.10.11.12',
        'x-forwarded-for': '13.14.15.16, 17.18.19.20',
      })
      expect(clientIpKey(req, { CLOUDFLARE_WORKERS: '1' })).toBe('9.10.11.12')
    })

    test('defaults to trusting proxy headers when CF_PAGES is set (edge)', () => {
      const req = makeRequest({ 'x-forwarded-for': '13.14.15.16' })
      expect(clientIpKey(req, { CF_PAGES: '1' })).toBe('13.14.15.16')
    })

    test('CF-Connecting-IP still wins over a trusted X-Forwarded-For', () => {
      const req = makeRequest({
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '9.9.9.9',
      })
      expect(clientIpKey(req, { CHM_TRUST_PROXY_HEADERS: 'true' })).toBe(
        '1.2.3.4'
      )
    })

    test('explicit CHM_TRUST_PROXY_HEADERS=false disables trusting on edge', () => {
      const req = makeRequest({ 'x-real-ip': '9.10.11.12' })
      expect(clientIpKey(req, { CHM_TRUST_PROXY_HEADERS: 'false' })).toBe(
        'unknown'
      )
    })
  })
})

describe('trustProxyHeaders', () => {
  const MANAGED_KEYS = [
    'CHM_TRUST_PROXY_HEADERS',
    'CF_PAGES',
    'CLOUDFLARE_WORKERS',
  ]
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of MANAGED_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of MANAGED_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  test('defaults to false on a plain Node runtime', () => {
    expect(trustProxyHeaders({})).toBe(false)
  })

  test('is true when CHM_TRUST_PROXY_HEADERS=true', () => {
    expect(trustProxyHeaders({ CHM_TRUST_PROXY_HEADERS: 'true' })).toBe(true)
  })

  test('is true when CHM_TRUST_PROXY_HEADERS=1', () => {
    expect(trustProxyHeaders({ CHM_TRUST_PROXY_HEADERS: '1' })).toBe(true)
  })

  test('is false when CHM_TRUST_PROXY_HEADERS=false (explicit opt-out)', () => {
    expect(trustProxyHeaders({ CHM_TRUST_PROXY_HEADERS: 'false' })).toBe(false)
  })

  test('is true on the Cloudflare runtime via CLOUDFLARE_WORKERS', () => {
    expect(trustProxyHeaders({ CLOUDFLARE_WORKERS: '1' })).toBe(true)
  })

  test('is true on the Cloudflare runtime via CF_PAGES', () => {
    expect(trustProxyHeaders({ CF_PAGES: '1' })).toBe(true)
  })
})

describe('getRateLimitBinding / checkRateLimitDurable (adapter selection)', () => {
  const BINDING = 'CHM_RATE_LIMIT_TEST'

  afterEach(() => {
    // Ensure no test leaks a binding onto the shared globalThis.
    delete (globalThis as Record<string, unknown>)[BINDING]
  })

  test('getRateLimitBinding returns undefined when no binding on globalThis', () => {
    expect(getRateLimitBinding(BINDING)).toBeUndefined()
  })

  test('getRateLimitBinding returns undefined when value lacks limit()', () => {
    ;(globalThis as Record<string, unknown>)[BINDING] = { nope: true }
    expect(getRateLimitBinding(BINDING)).toBeUndefined()
  })

  test('getRateLimitBinding resolves a well-formed binding', () => {
    const stub: RateLimitBinding = {
      limit: async () => ({ success: true }),
    }
    ;(globalThis as Record<string, unknown>)[BINDING] = stub
    expect(getRateLimitBinding(BINDING)).toBe(stub)
  })

  test('delegates to the binding when present (allowed)', async () => {
    let called = 0
    const stub: RateLimitBinding = {
      limit: async ({ key }) => {
        called++
        expect(key).toBe('durable-key')
        return { success: true }
      },
    }
    ;(globalThis as Record<string, unknown>)[BINDING] = stub

    const result = await checkRateLimitDurable('durable-key', 5, BINDING)
    expect(called).toBe(1)
    expect(result.allowed).toBe(true)
    expect(result.retryAfterSec).toBe(0)
    // Binding path must NOT touch the in-memory bucket store.
    expect(_bucketCountForTest()).toBe(0)
  })

  test('delegates to the binding when present (blocked → 429 backoff)', async () => {
    const stub: RateLimitBinding = { limit: async () => ({ success: false }) }
    ;(globalThis as Record<string, unknown>)[BINDING] = stub

    const result = await checkRateLimitDurable('blocked-key', 5, BINDING)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSec).toBeGreaterThan(0)
    expect(_bucketCountForTest()).toBe(0)
  })

  test('falls back to the in-memory limiter when binding is absent', async () => {
    const result = await checkRateLimitDurable('fallback-key', 3, BINDING)
    expect(result.allowed).toBe(true)
    // In-memory path was used, so a bucket now exists for the key.
    expect(_bucketCountForTest()).toBe(1)
  })

  test('in-memory fallback still enforces the limit across calls', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimitDurable('fallback-burst', 3, BINDING)
      expect(r.allowed).toBe(true)
    }
    const denied = await checkRateLimitDurable('fallback-burst', 3, BINDING)
    expect(denied.allowed).toBe(false)
  })

  test('fails open to the in-memory limiter when the binding throws', async () => {
    const stub: RateLimitBinding = {
      limit: async () => {
        throw new Error('edge counter unavailable')
      },
    }
    ;(globalThis as Record<string, unknown>)[BINDING] = stub

    const result = await checkRateLimitDurable('error-key', 4, BINDING)
    expect(result.allowed).toBe(true)
    // Fell through to the Map path.
    expect(_bucketCountForTest()).toBe(1)
  })
})
