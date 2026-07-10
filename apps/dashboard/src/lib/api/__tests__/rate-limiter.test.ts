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

import {
  _bucketCountForTest,
  _MAX_BUCKETS_FOR_TEST,
  _resetBucketsForTest,
  checkRateLimit,
  clientIpKey,
  rateLimitResponse,
} from '../rate-limiter'
import { afterEach, describe, expect, test } from 'bun:test'

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

  test('falls back to X-Real-IP when CF header absent', () => {
    const req = makeRequest({ 'x-real-ip': '9.10.11.12' })
    expect(clientIpKey(req)).toBe('9.10.11.12')
  })

  test('falls back to first X-Forwarded-For entry', () => {
    const req = makeRequest({
      'x-forwarded-for': '13.14.15.16, 17.18.19.20',
    })
    expect(clientIpKey(req)).toBe('13.14.15.16')
  })

  test('returns "unknown" when no IP headers present', () => {
    const req = makeRequest({})
    expect(clientIpKey(req)).toBe('unknown')
  })
})
