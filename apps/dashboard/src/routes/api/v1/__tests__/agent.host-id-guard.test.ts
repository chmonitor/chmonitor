/**
 * POST /api/v1/agent must treat `hostId` exactly like the chart/table routes:
 *
 * - a negative id (a per-user connection in cloud mode) is never clamped to
 *   host 0 — it goes on to be resolved to the caller's own connection;
 * - a fractional / junk id is a 400, not a truncated host;
 * - a signed-in cloud user can never reach the hidden env/demo host (#2172),
 *   while an anonymous cloud visitor keeps the read-only demo.
 *
 * The real `isDemoHostBlockedForRequest` runs; only its inputs (cloud mode,
 * Clerk session) are mocked. `resolveAgentUserId` is the first step after the
 * guard, so its call count proves whether a request got past it.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

let cloudMode = false
let signedIn = false

mock.module('@/lib/cloud/cloud-mode', () => ({
  isCloudModeServer: () => cloudMode,
  isCloudModeClient: () => cloudMode,
  parseCloudMode: (value: string | null | undefined) =>
    value === 'true' || value === '1' || value === 'cloud',
}))

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

mock.module('@/lib/api/rate-limiter', () => ({
  checkRateLimitDurable: async () => ({
    allowed: true as const,
    retryAfterSec: 0,
    remaining: 10,
  }),
  clientIpKey: () => '203.0.113.9',
  getAgentRateLimitPerMin: () => 10,
  getGuestAiRateLimitPerMin: () => 5,
  RATE_LIMIT_BINDING_AGENT: 'AGENT_RL',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}))
mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: () => {},
}))
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: async () => null,
}))

const PAST_GUARD = 'past-the-host-guard'
const resolveAgentUserId = mock(async () => {
  throw new Error(PAST_GUARD)
})
mock.module('../-agent/runtime', () => ({
  resolveAgentUserId,
  resolveAgentModel: async () => 'test/test-model',
  createAgentRuntime: async () => {
    throw new Error('not reached')
  },
  buildUiMessages: () => [],
}))

const { Route } = await import('../agent')

type PostHandler = (ctx: { request: Request }) => Promise<Response>
const post = (
  Route.options as unknown as { server: { handlers: { POST: PostHandler } } }
).server.handlers.POST

function postAgent(hostId: unknown): Promise<Response> {
  return post({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', hostId }),
    }),
  })
}

describe('POST /api/v1/agent — host id validation and demo-host rule', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    resolveAgentUserId.mockClear()
  })

  for (const userConnectionId of [-1, '-1001']) {
    test(`passes per-user connection id ${JSON.stringify(userConnectionId)} on to connection resolution, never to host 0`, async () => {
      cloudMode = true
      signedIn = true
      await postAgent(userConnectionId)
      // Not blocked as the demo host and not a parse error: the route goes on
      // to resolve the caller, then the connection (agent.user-connection.test.ts).
      expect(resolveAgentUserId).toHaveBeenCalledTimes(1)
    })
  }

  for (const bad of [1.5, '1.5', '1abc', '', 'abc', true]) {
    test(`rejects hostId ${JSON.stringify(bad)} with 400 instead of using host 0`, async () => {
      const res = await postAgent(bad)
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('INVALID_HOST_ID')
      expect(resolveAgentUserId).not.toHaveBeenCalled()
    })
  }

  test('signed-in cloud user + demo host 0 is blocked with demo_hidden', async () => {
    cloudMode = true
    signedIn = true
    const res = await postAgent(0)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('demo_hidden')
    expect(resolveAgentUserId).not.toHaveBeenCalled()
  })

  test('signed-in cloud user with no hostId (defaults to 0) is also blocked', async () => {
    cloudMode = true
    signedIn = true
    const res = await postAgent(undefined)
    expect(res.status).toBe(403)
    expect(resolveAgentUserId).not.toHaveBeenCalled()
  })

  test('anonymous cloud visitor keeps the read-only demo host', async () => {
    cloudMode = true
    signedIn = false
    await postAgent(0)
    expect(resolveAgentUserId).toHaveBeenCalledTimes(1)
  })

  test('OSS signed-in caller on host 1 is unaffected', async () => {
    cloudMode = false
    signedIn = true
    await postAgent('1')
    expect(resolveAgentUserId).toHaveBeenCalledTimes(1)
  })
})
