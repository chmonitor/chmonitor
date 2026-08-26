/**
 * Route-level characterization tests for POST /api/v1/auth/api-key.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const TEST_SECRET = 'test-api-key-route-secret-at-least-32-chars'

let issueApiKeyImpl = mock(
  async (sub: string, days?: number, scopes?: string[]) =>
    `chm_mock.${sub}.${days ?? 30}.${scopes?.join(',') ?? 'all'}`
)

mock.module('@chm/mcp-server/auth', () => ({
  ALL_API_KEY_SCOPES: [
    'read:metrics',
    'read:insights',
    'agent:run',
    'mcp:access',
  ],
  getBearerToken: (header: string | null) => {
    if (!header?.startsWith('Bearer ')) return null
    return header.slice('Bearer '.length).trim() || null
  },
  issueApiKey: (sub: string, days?: number, scopes?: string[]) =>
    issueApiKeyImpl(sub, days, scopes),
  timingSafeEqualString: (a: string, b: string) => a === b,
}))

let authProvider: 'none' | 'clerk' = 'none'
let sessionAuth: { authenticated: boolean; subject?: string } = {
  authenticated: false,
}

mock.module('@/lib/auth/provider', () => ({
  getAuthProvider: () => authProvider,
}))

mock.module('@/lib/auth/providers', () => ({
  resolveServerAuthProvider: (_provider: string) => ({
    authenticateRequest: async () => sessionAuth,
  }),
}))

const { __handlePostForTests: handlePost } = await import('./api-key')

const ENV_KEYS = ['CHM_API_KEY_SECRET', 'CHM_AUTH_PROVIDER'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
  }
  process.env.CHM_API_KEY_SECRET = TEST_SECRET
  process.env.CHM_AUTH_PROVIDER = 'none'
  authProvider = 'none'
  sessionAuth = { authenticated: false }
  issueApiKeyImpl = mock(
    async (sub: string, days?: number, scopes?: string[]) =>
      `chm_mock.${sub}.${days ?? 30}.${scopes?.join(',') ?? 'all'}`
  )
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://dash.example.com/api/v1/auth/api-key', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/auth/api-key', () => {
  test('503 when CHM_API_KEY_SECRET is unset', async () => {
    delete process.env.CHM_API_KEY_SECRET
    const res = await handlePost(post({}))
    expect(res.status).toBe(503)
  })

  test('401 for provider=none without bearer secret or session', async () => {
    const res = await handlePost(post({ label: 'cli' }))
    expect(res.status).toBe(401)
  })

  test('401 when bearer secret mismatches', async () => {
    const res = await handlePost(
      post({}, { authorization: 'Bearer wrong-secret' })
    )
    expect(res.status).toBe(401)
  })

  test('200 via admin secret uses body label as sub', async () => {
    const res = await handlePost(
      post(
        { label: 'ops-key', days: 14, scopes: ['mcp:access', 'bogus'] },
        { authorization: `Bearer ${TEST_SECRET}` }
      )
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        sub: string
        apiKey: string
        scopes: string[]
        expiresInDays: number
      }
    }
    expect(body.data.sub).toBe('ops-key')
    expect(body.data.expiresInDays).toBe(14)
    expect(body.data.scopes).toEqual(['mcp:access'])
    expect(body.data.apiKey).toContain('chm_mock.ops-key')
  })

  test('200 via session uses authenticated user id as sub', async () => {
    authProvider = 'clerk'
    sessionAuth = { authenticated: true, subject: 'user_abc' }
    const res = await handlePost(
      post(
        { label: 'ignored-label', days: 30 },
        { authorization: 'Bearer not-secret' }
      )
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { sub: string } }
    expect(body.data.sub).toBe('user_abc')
  })

  test('401 via session when unauthenticated', async () => {
    authProvider = 'clerk'
    sessionAuth = { authenticated: false }
    const res = await handlePost(post({ label: 'cli' }))
    expect(res.status).toBe(401)
  })

  test('400 for invalid JSON body', async () => {
    const res = await handlePost(
      new Request('https://dash.example.com/api/v1/auth/api-key', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TEST_SECRET}`,
          'content-type': 'application/json',
        },
        body: '{not-json',
      })
    )
    expect(res.status).toBe(400)
  })

  test('400 for invalid days', async () => {
    const res = await handlePost(
      post({ days: 0 }, { authorization: `Bearer ${TEST_SECRET}` })
    )
    expect(res.status).toBe(400)
  })
})
