import { _resetBucketsForTest, createIpRateLimitCheck } from '../rate-limit'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

function req(ip: string): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
  })
}

describe('createIpRateLimitCheck', () => {
  const originalLimit = process.env.RATE_LIMIT_MCP_PER_MIN

  beforeEach(() => {
    _resetBucketsForTest()
  })

  afterEach(() => {
    if (originalLimit !== undefined) {
      process.env.RATE_LIMIT_MCP_PER_MIN = originalLimit
    } else {
      delete process.env.RATE_LIMIT_MCP_PER_MIN
    }
    delete (globalThis as Record<string, unknown>).TEST_RATE_LIMIT_BINDING
  })

  it('allows requests under the limit', async () => {
    process.env.RATE_LIMIT_MCP_PER_MIN = '3'
    const check = createIpRateLimitCheck()
    expect(await check(req('1.1.1.1'))).toBeNull()
    expect(await check(req('1.1.1.1'))).toBeNull()
    expect(await check(req('1.1.1.1'))).toBeNull()
  })

  it('429s once the per-IP budget is exhausted, with Retry-After', async () => {
    process.env.RATE_LIMIT_MCP_PER_MIN = '2'
    const check = createIpRateLimitCheck()
    await check(req('2.2.2.2'))
    await check(req('2.2.2.2'))
    const res = await check(req('2.2.2.2'))
    expect(res?.status).toBe(429)
    expect(Number(res?.headers.get('Retry-After'))).toBeGreaterThan(0)
    const body = (await res?.json()) as {
      error: { type: string; retryAfterSec: number }
    }
    expect(body.error.type).toBe('rate_limited')
  })

  it('tracks each client IP independently', async () => {
    process.env.RATE_LIMIT_MCP_PER_MIN = '1'
    const check = createIpRateLimitCheck()
    await check(req('3.3.3.3'))
    expect((await check(req('3.3.3.3')))?.status).toBe(429)
    // a different IP still has a full bucket
    expect(await check(req('4.4.4.4'))).toBeNull()
  })

  it('falls back to the default limit on junk env values', async () => {
    process.env.RATE_LIMIT_MCP_PER_MIN = 'not-a-number'
    const check = createIpRateLimitCheck()
    // default is 30 — well above the two calls made here
    expect(await check(req('5.5.5.5'))).toBeNull()
    expect(await check(req('5.5.5.5'))).toBeNull()
  })

  it('uses the Cloudflare binding when present and 429s on { success: false }', async () => {
    const seenKeys: string[] = []
    ;(globalThis as Record<string, unknown>).TEST_RATE_LIMIT_BINDING = {
      limit: async ({ key }: { key: string }) => {
        seenKeys.push(key)
        return { success: false }
      },
    }
    const check = createIpRateLimitCheck({
      bindingName: 'TEST_RATE_LIMIT_BINDING',
    })
    const res = await check(req('6.6.6.6'))
    expect(res?.status).toBe(429)
    expect(seenKeys).toEqual(['mcp:ip:6.6.6.6'])
  })

  it('fails open to the in-memory bucket when the binding throws', async () => {
    ;(globalThis as Record<string, unknown>).TEST_RATE_LIMIT_BINDING = {
      limit: async () => {
        throw new Error('edge unavailable')
      },
    }
    process.env.RATE_LIMIT_MCP_PER_MIN = '1'
    const check = createIpRateLimitCheck({
      bindingName: 'TEST_RATE_LIMIT_BINDING',
    })
    // first request passes via the fallback bucket; second exhausts it
    expect(await check(req('7.7.7.7'))).toBeNull()
    expect((await check(req('7.7.7.7')))?.status).toBe(429)
  })
})
