/**
 * Unit tests for the rate-limit guard on /api/mcp (#2704).
 *
 * /api/mcp exposes arbitrary read-only SQL execution (the `query` tool, plus
 * 10 other ClickHouse-querying tools) with no throttle before this change —
 * this reuses the same `checkRateLimitDurable` in-memory token bucket already
 * guarding the agent's SQL-executing route. Coverage: allowed under the
 * configured limit, blocked (429 + Retry-After) once exhausted, and
 * independent buckets per client IP.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { _resetBucketsForTest } from '@/lib/api/rate-limiter'

const { __checkMcpRateLimitForTests: checkMcpRateLimit } = await import(
  '../mcp'
)

const ORIGINAL_LIMIT = process.env.RATE_LIMIT_MCP_PER_MIN

function makeRequest(ip = '203.0.113.1'): Request {
  return new Request('https://dash.example.com/api/mcp', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
  })
}

beforeEach(() => {
  _resetBucketsForTest()
  process.env.RATE_LIMIT_MCP_PER_MIN = '3'
})

afterEach(() => {
  _resetBucketsForTest()
  if (ORIGINAL_LIMIT === undefined) {
    delete process.env.RATE_LIMIT_MCP_PER_MIN
  } else {
    process.env.RATE_LIMIT_MCP_PER_MIN = ORIGINAL_LIMIT
  }
})

describe('checkMcpRateLimit', () => {
  test('allows requests under the configured per-IP limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      const result = await checkMcpRateLimit(makeRequest())
      expect(result).toBeNull()
    }
  })

  test('blocks the request once the limit is exhausted with a 429', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkMcpRateLimit(makeRequest())).toBeNull()
    }

    const blocked = await checkMcpRateLimit(makeRequest())
    expect(blocked).not.toBeNull()
    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get('Retry-After')).toBeTruthy()

    const body = (await blocked?.json()) as {
      success: boolean
      error: { type: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('rate_limited')
  })

  test('429 response carries CORS headers so cross-origin MCP clients can read it', async () => {
    for (let i = 0; i < 3; i += 1) {
      await checkMcpRateLimit(makeRequest())
    }
    const blocked = await checkMcpRateLimit(makeRequest())
    expect(blocked?.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('different client IPs get independent buckets', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await checkMcpRateLimit(makeRequest('203.0.113.1'))).toBeNull()
    }
    // IP 1 is now exhausted...
    expect(await checkMcpRateLimit(makeRequest('203.0.113.1'))).not.toBeNull()
    // ...but a different IP is untouched.
    expect(await checkMcpRateLimit(makeRequest('203.0.113.2'))).toBeNull()
  })
})
