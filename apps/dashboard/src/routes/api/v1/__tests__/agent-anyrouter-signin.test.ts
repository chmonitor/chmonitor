/**
 * POST /api/v1/agent wiring for "Sign in with AnyRouter": which key reaches
 * the agent runtime, and whether the request is metered.
 *
 * - Cloud guest + flag on + own token → that exact token, no daily reservation.
 * - Same request, flag off → no user key, metered against the guest cap.
 * - Signed-in, no request key, stored token → the stored token.
 *
 * Mocking strategy mirrors agent-guest-rate-limit.test.ts. `createClickHouseAgent`
 * records its options then throws, so the test stops right after the gates.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

let cloudMode = true
mock.module('@/lib/cloud/cloud-mode', () => ({
  isCloudModeServer: () => cloudMode,
  isCloudModeClient: () => cloudMode,
  parseCloudMode: (value: string | null | undefined) =>
    value === 'true' || value === '1' || value === 'cloud',
}))

mock.module('@/lib/api/rate-limiter', () => ({
  checkRateLimitDurable: async () => ({
    allowed: true as const,
    retryAfterSec: 0,
    remaining: 10,
  }),
  clientIpKey: () => '203.0.113.9',
  getAgentRateLimitPerMin: () => 10,
  RATE_LIMIT_BINDING_AGENT: 'AGENT_RL',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}))
mock.module('@/lib/api/server-env', () => ({ bridgeClickHouseEnv: () => {} }))
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: async () => null,
}))

let signedInUser: string | null = null
mock.module('@/lib/auth/provider', () => ({
  isClerkAuthProvider: () => signedInUser !== null,
  getAuthProvider: () => (signedInUser ? 'clerk' : 'none'),
  parseAuthProvider: () => 'none',
}))
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: signedInUser }),
}))
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))
let autoAlias = false
mock.module('@/lib/ai/anyrouter-dynamic-models', () => ({
  isAnyRouterAutoModelId: (id: string) => autoAlias && id === 'anyrouter:auto',
  resolveAnyRouterAutoModelId: async () => null,
  loadAnyRouterDynamicModelEntries: async () => [],
}))
mock.module('@/lib/ai/agent/mcp/connect-custom-servers', () => ({
  loadUserRegisteredServers: async () => [],
  mergeMcpServers: () => [],
  connectCustomMcpServers: async () => ({
    tools: {},
    closeAll: async () => {},
    statuses: [],
  }),
}))

const resolveBillingOwner = mock(async () => {
  if (!signedInUser) throw new Error('no clerk owner')
  return { type: 'user' as const, id: signedInUser }
})
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
  resolveBillingOwnerId: async () => 'unused',
}))
mock.module('@/lib/billing/user-subscription', () => ({
  getPlanForOwner: async () => ({
    id: 'free',
    aiRequestsPerDay: 5,
    aiMonthlyUsdBudget: null,
  }),
}))
const reserveAiUsage = mock(async (_owner?: string) => 1)
mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage: (owner?: string) => reserveAiUsage(owner),
  releaseAiUsage: async () => {},
  getAiSpendThisMonth: async () => 0,
  meterAiOverage: async () => {},
  recordByokActivation: async () => {},
}))

let storedToken: string | null = null
const getUserProviderToken = mock(async (_owner: string, _p: string) =>
  storedToken ? { token: storedToken, expiresAt: null } : null
)
mock.module('@/lib/ai/agent/user-token-store', () => ({
  getUserProviderToken: (owner: string, p: string) =>
    getUserProviderToken(owner, p),
}))

const createClickHouseAgent = mock((_opts: { apiKey?: string }) => {
  throw new Error('boom: stop after gates')
})
mock.module('@/lib/ai/agent', () => ({ createClickHouseAgent }))

const { Route } = await import('@/routes/api/v1/agent')
const post = (
  Route.options as unknown as {
    server: {
      handlers: { POST: (ctx: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

const FLAG = 'CHM_AGENT_ANYROUTER_SIGNIN_ENABLED'
const savedFlag = process.env[FLAG]
const savedKey = process.env.ANYROUTER_API_KEY
const TOKEN = 'ar-user-token-abcdef123456'

function send(body: Record<string, unknown>): Promise<Response> {
  return post({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', ...body }),
    }),
  })
}

function runtimeApiKey(): string | undefined {
  expect(createClickHouseAgent).toHaveBeenCalledTimes(1)
  return createClickHouseAgent.mock.calls[0]?.[0]?.apiKey
}

beforeEach(() => {
  cloudMode = true
  signedInUser = null
  storedToken = null
  process.env.ANYROUTER_API_KEY = 'deployment-key-000000'
  createClickHouseAgent.mockClear()
  reserveAiUsage.mockClear()
  getUserProviderToken.mockClear()
})

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = savedFlag
  if (savedKey === undefined) delete process.env.ANYROUTER_API_KEY
  else process.env.ANYROUTER_API_KEY = savedKey
})

describe('POST /api/v1/agent — Sign in with AnyRouter', () => {
  test('cloud guest, flag on, own token: runtime gets that token and the cap is not charged', async () => {
    process.env[FLAG] = 'true'
    await send({ apiKey: TOKEN, model: 'anyrouter:openai/gpt-5' })
    expect(runtimeApiKey()).toBe(TOKEN)
    expect(reserveAiUsage).not.toHaveBeenCalled()
  })

  test('cloud guest, flag off, same request: token dropped and the guest cap is charged', async () => {
    delete process.env[FLAG]
    await send({ apiKey: TOKEN, model: 'anyrouter:openai/gpt-5' })
    expect(runtimeApiKey()).toBeUndefined()
    expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    expect(reserveAiUsage.mock.calls[0]?.[0]).toStartWith('guest:')
  })

  test('cloud guest, flag on, anyrouter:auto resolved to another provider: token never leaves for it', async () => {
    // No AnyRouter deployment key → `anyrouter:auto` resolves to the fallback
    // provider. The guest's AnyRouter token must not be sent there.
    process.env[FLAG] = 'true'
    delete process.env.ANYROUTER_API_KEY
    const savedOpenRouter = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'or-deployment-key-000000'
    autoAlias = true
    try {
      await send({ apiKey: TOKEN, model: 'anyrouter:auto' })
      const calls = createClickHouseAgent.mock.calls
      if (calls.length > 0) expect(calls[0]?.[0]?.apiKey).not.toBe(TOKEN)
      expect(reserveAiUsage).toHaveBeenCalledTimes(1)
    } finally {
      autoAlias = false
      if (savedOpenRouter === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = savedOpenRouter
    }
  })

  test('signed-in, no request key: the stored token reaches the runtime, not metered', async () => {
    process.env[FLAG] = 'true'
    signedInUser = 'user_a'
    storedToken = TOKEN
    await send({ model: 'anyrouter:openai/gpt-5' })
    expect(getUserProviderToken).toHaveBeenCalledWith('user_a', 'anyrouter')
    expect(runtimeApiKey()).toBe(TOKEN)
    expect(reserveAiUsage).not.toHaveBeenCalled()
  })

  test('signed-in, request key wins over the stored token', async () => {
    process.env[FLAG] = 'true'
    signedInUser = 'user_a'
    storedToken = TOKEN
    await send({
      apiKey: 'request-key-123456',
      model: 'anyrouter:openai/gpt-5',
    })
    expect(runtimeApiKey()).toBe('request-key-123456')
    expect(getUserProviderToken).not.toHaveBeenCalled()
  })

  test('signed-in, flag off: stored token is never read; metered as usual', async () => {
    delete process.env[FLAG]
    signedInUser = 'user_a'
    storedToken = TOKEN
    await send({ model: 'anyrouter:openai/gpt-5' })
    expect(getUserProviderToken).not.toHaveBeenCalled()
    expect(runtimeApiKey()).toBeUndefined()
    expect(reserveAiUsage).toHaveBeenCalledWith('user_a')
  })
})
