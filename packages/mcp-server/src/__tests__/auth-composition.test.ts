/**
 * Auth composition matrix: verifyApiKey disabled sentinel must not bypass
 * scheme-specific gates (MCP defaultAuthenticator, dashboard hasValidChmApiKey).
 */

import { issueApiKey, verifyApiKey } from '../auth/api-key'
import { defaultAuthenticator } from '../http'
import { afterEach, describe, expect, it } from 'bun:test'

const TEST_SECRET = 'test-secret-key-for-unit-tests-at-least-32-chars'
const originalFetch = globalThis.fetch

const ENV = [
  'CHM_API_KEY_SECRET',
  'CHM_MCP_PUBLIC',
  'CLERK_SECRET_KEY',
] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))

function mcpReq(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/mcp', { method: 'POST', headers })
}

function clearEnv() {
  for (const k of ENV) delete process.env[k]
}

describe('verifyApiKey disabled sentinel', () => {
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
      else delete process.env[k]
    }
  })

  it('returns invalid/disabled when CHM_API_KEY_SECRET is unset', async () => {
    clearEnv()
    const result = await verifyApiKey('anything')
    expect(result).toEqual({ valid: false, reason: 'disabled' })
  })
})

describe('defaultAuthenticator composition matrix', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const k of ENV) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
      else delete process.env[k]
    }
  })

  it('401s when neither scheme is configured and CHM_MCP_PUBLIC is unset', async () => {
    clearEnv()
    expect((await defaultAuthenticator(mcpReq()))?.status).toBe(401)
  })

  it('allows when CHM_MCP_PUBLIC=true and no auth schemes configured', async () => {
    clearEnv()
    process.env.CHM_MCP_PUBLIC = 'true'
    expect(await defaultAuthenticator(mcpReq())).toBeNull()
  })

  it('401s clerk-only + garbage Authorization bearer', async () => {
    clearEnv()
    process.env.CLERK_SECRET_KEY = 'sk_test_x'
    globalThis.fetch = (async () =>
      new Response('no', { status: 401 })) as typeof fetch
    expect(
      (await defaultAuthenticator(mcpReq({ authorization: 'Bearer garbage' })))
        ?.status
    ).toBe(401)
  })

  it('401s clerk-only + garbage x-api-key (would wrongly pass naive verifyApiKey)', async () => {
    clearEnv()
    process.env.CLERK_SECRET_KEY = 'sk_test_x'
    let clerkCalled = false
    globalThis.fetch = (async () => {
      clerkCalled = true
      return Response.json({ subject: 'user_1' })
    }) as typeof fetch
    const res = await defaultAuthenticator(
      mcpReq({ 'x-api-key': 'chm_garbage' })
    )
    expect(res?.status).toBe(401)
    expect(clerkCalled).toBe(false)
  })

  it('allows valid chm_ key when api-key auth is enabled', async () => {
    clearEnv()
    process.env.CHM_API_KEY_SECRET = TEST_SECRET
    const key = await issueApiKey('cli')
    expect(
      await defaultAuthenticator(mcpReq({ authorization: `Bearer ${key}` }))
    ).toBeNull()
  })
})
