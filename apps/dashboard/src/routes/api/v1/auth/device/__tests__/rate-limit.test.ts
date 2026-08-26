/**
 * Rate-limit and RFC 8628 slow_down tests for unauthenticated device-code routes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { _resetBucketsForTest } from '@/lib/api/rate-limiter'
import {
  __resetDeviceCodeMemoryForTests,
  insertDeviceCode,
} from '@/lib/auth/device-code-store'

const ORIGINAL_LIMIT = process.env.RATE_LIMIT_DEVICE_CODE_PER_MIN
const ORIGINAL_SECRET = process.env.CHM_API_KEY_SECRET
const ORIGINAL_DEVICE_LOGIN = process.env.CHM_DEVICE_LOGIN
const ORIGINAL_CLOUD = process.env.CHM_CLOUD_MODE
const ORIGINAL_AUTH = process.env.CHM_AUTH_PROVIDER

function enableDeviceLogin() {
  process.env.CHM_DEVICE_LOGIN = 'true'
  process.env.CHM_API_KEY_SECRET = 'test-device-login-secret-at-least-32-chars'
  process.env.CHM_CLOUD_MODE = 'false'
  process.env.CHM_AUTH_PROVIDER = 'none'
}

const {
  __checkDeviceCodeRateLimitForTests: checkRateLimit,
  __handlePostForTests: handleCodePost,
} = await import('../code')

const { __handlePostForTests: handleTokenPost } = await import('../../token')

beforeEach(() => {
  _resetBucketsForTest()
  __resetDeviceCodeMemoryForTests()
  process.env.RATE_LIMIT_DEVICE_CODE_PER_MIN = '3'
  enableDeviceLogin()
})

afterEach(() => {
  _resetBucketsForTest()
  __resetDeviceCodeMemoryForTests()
  if (ORIGINAL_LIMIT === undefined)
    delete process.env.RATE_LIMIT_DEVICE_CODE_PER_MIN
  else process.env.RATE_LIMIT_DEVICE_CODE_PER_MIN = ORIGINAL_LIMIT
  if (ORIGINAL_SECRET === undefined) delete process.env.CHM_API_KEY_SECRET
  else process.env.CHM_API_KEY_SECRET = ORIGINAL_SECRET
  if (ORIGINAL_DEVICE_LOGIN === undefined) delete process.env.CHM_DEVICE_LOGIN
  else process.env.CHM_DEVICE_LOGIN = ORIGINAL_DEVICE_LOGIN
  if (ORIGINAL_CLOUD === undefined) delete process.env.CHM_CLOUD_MODE
  else process.env.CHM_CLOUD_MODE = ORIGINAL_CLOUD
  if (ORIGINAL_AUTH === undefined) delete process.env.CHM_AUTH_PROVIDER
  else process.env.CHM_AUTH_PROVIDER = ORIGINAL_AUTH
})

function codeRequest(ip = '203.0.113.50'): Request {
  return new Request('https://dash.example.com/api/v1/auth/device/code', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    body: '{}',
  })
}

function tokenRequest(deviceCode: string, ip = '203.0.113.50'): Request {
  return new Request('https://dash.example.com/api/v1/auth/token', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'device_code',
      device_code: deviceCode,
    }),
  })
}

describe('POST /api/v1/auth/device/code rate limit', () => {
  test('allows requests under the per-IP limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await handleCodePost(codeRequest())
      expect(res.status).toBe(200)
    }
  })

  test('returns 429 on the next request within the window', async () => {
    for (let i = 0; i < 3; i += 1) {
      await handleCodePost(codeRequest())
    }
    const res = await handleCodePost(codeRequest())
    expect(res.status).toBe(429)
  })

  test('checkRateLimit export uses device-code bucket prefix', async () => {
    const req = codeRequest('198.51.100.7')
    expect(await checkRateLimit(req)).toBeNull()
    expect(await checkRateLimit(req)).toBeNull()
    expect(await checkRateLimit(req)).toBeNull()
    const blocked = await checkRateLimit(req)
    expect(blocked?.status).toBe(429)
  })
})

describe('POST /api/v1/auth/token slow_down', () => {
  test('returns slow_down when polled inside intervalSec', async () => {
    const now = Date.now()
    const deviceCode = 'device-code-slow-down-test'
    await insertDeviceCode({
      deviceCode,
      userCode: 'ABCD-EFGH',
      clientId: 'chm-cli',
      createdAt: now,
      expiresAt: now + 900_000,
      intervalSec: 5,
    })

    const first = await handleTokenPost(tokenRequest(deviceCode))
    expect(first.status).toBe(400)
    expect((await first.json()) as { error: string }).toMatchObject({
      error: 'authorization_pending',
    })

    const second = await handleTokenPost(tokenRequest(deviceCode))
    expect(second.status).toBe(429)
    expect(
      (await second.json()) as { error: string; interval: number }
    ).toEqual({
      error: 'slow_down',
      interval: 5,
    })
  })

  test('allows pending poll after interval elapses', async () => {
    const now = Date.now()
    const deviceCode = 'device-code-interval-elapsed'
    await insertDeviceCode({
      deviceCode,
      userCode: 'WXYZ-1234',
      clientId: 'chm-cli',
      createdAt: now - 10_000,
      expiresAt: now + 900_000,
      intervalSec: 5,
    })

    const res = await handleTokenPost(tokenRequest(deviceCode))
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({
      error: 'authorization_pending',
    })
  })
})
