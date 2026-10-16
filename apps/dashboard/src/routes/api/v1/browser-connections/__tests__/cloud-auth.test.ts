/**
 * In cloud mode the browser-connections routes need a signed-in caller; on
 * self-hosted (auth `none`) anonymous callers keep working.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { issueApiKey } from '@chm/mcp-server/auth'

const { __handlePostForTests: proxyPost } = await import('../proxy')
const { __handlePostForTests: sessionsPost } = await import('../sessions')
const { __handlePostForTests: testPost } = await import('../test')

const KEYS = [
  'CHM_CLOUD_MODE',
  'CHM_AUTH_PROVIDER',
  'CHM_API_KEY_SECRET',
  'CHM_CLERK_PUBLIC_READ',
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const TEST_SECRET = 'test-secret-key-for-unit-tests-at-least-32-chars'

const routes = [
  ['proxy', proxyPost],
  ['sessions', sessionsPost],
  ['test', testPost],
] as const

// Invalid JSON ends every handler at a non-401 response without any network I/O.
const req = () =>
  new Request('https://dash.example.com/api/v1/browser-connections/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  })

describe('browser-connections cloud-mode sign-in', () => {
  for (const [name, handler] of routes) {
    test(`${name}: anonymous cloud request is rejected with 401`, async () => {
      process.env.CHM_CLOUD_MODE = 'true'
      process.env.CHM_AUTH_PROVIDER = 'clerk'
      process.env.CHM_CLERK_PUBLIC_READ = 'true'
      const res = await handler(req())
      expect(res.status).toBe(401)
      expect((await res.json()) as { error: string }).toEqual({
        error: 'Authentication required',
      })
    })

    test(`${name}: cloud request with a valid chm_ key is let through`, async () => {
      process.env.CHM_CLOUD_MODE = 'true'
      process.env.CHM_AUTH_PROVIDER = 'clerk'
      process.env.CHM_CLERK_PUBLIC_READ = 'true'
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const key = await issueApiKey('browser-connections-test')
      const res = await handler(
        new Request('https://dash.example.com/api/v1/browser-connections/x', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: '{',
        })
      )
      expect(res.status).not.toBe(401)
    })

    test(`${name}: cloud request with an invalid chm_ key is rejected`, async () => {
      process.env.CHM_CLOUD_MODE = 'true'
      process.env.CHM_AUTH_PROVIDER = 'clerk'
      process.env.CHM_API_KEY_SECRET = TEST_SECRET
      const res = await handler(
        new Request('https://dash.example.com/api/v1/browser-connections/x', {
          method: 'POST',
          headers: { authorization: 'Bearer chm_not-a-real-key' },
          body: '{',
        })
      )
      expect(res.status).toBe(401)
    })

    for (const provider of ['trusted', 'clerk'] as const) {
      test(`${name}: self-hosted ${provider} anonymous request is not auth-gated`, async () => {
        process.env.CHM_AUTH_PROVIDER = provider
        const res = await handler(req())
        expect(res.status).not.toBe(401)
      })
    }

    test(`${name}: self-hosted anonymous request is not auth-gated`, async () => {
      const res = await handler(req())
      expect(res.status).not.toBe(401)
    })
  }
})
