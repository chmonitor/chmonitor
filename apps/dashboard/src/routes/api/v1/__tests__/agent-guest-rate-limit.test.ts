/**
 * Cloud guest identity rate limit on POST /api/v1/agent.
 *
 * Asserts the durable RL key + guest-per-min limit after auth resolves to
 * `guest`. Mocking strategy mirrors agent.test.ts.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { guestOwnerIdFromIp } from '@/lib/billing/guest-ai'

mock.module('cloudflare:workers', () => ({ env: {} }))

let cloudMode = false
mock.module('@/lib/cloud/cloud-mode', () => ({
  isCloudModeServer: () => cloudMode,
  isCloudModeClient: () => cloudMode,
  parseCloudMode: (value: string | null | undefined) =>
    value === 'true' || value === '1' || value === 'cloud',
}))

const checkRateLimitDurable = mock(
  async (_key?: string, _limit?: number, _binding?: string) => ({
    allowed: true as const,
    retryAfterSec: 0,
    remaining: 10,
  })
)

mock.module('@/lib/api/rate-limiter', () => ({
  checkRateLimitDurable,
  clientIpKey: () => '203.0.113.9',
  getAgentRateLimitPerMin: () => 10,
  RATE_LIMIT_BINDING_AGENT: 'AGENT_RL',
  rateLimitResponse: (retryAfterSec: number) =>
    new Response(JSON.stringify({ error: 'rate limited', retryAfterSec }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
}))
mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: () => {},
}))
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: async () => null,
}))
mock.module('@/lib/auth/provider', () => ({
  isClerkAuthProvider: () => false,
  getAuthProvider: () => 'none',
  parseAuthProvider: (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase()
    if (
      normalized === 'clerk' ||
      normalized === 'proxy' ||
      normalized === 'trusted'
    ) {
      return normalized
    }
    return 'none'
  },
}))
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))
mock.module('@/lib/ai/providers', () => ({
  parseModelId: () => ({ provider: 'test', model: 'test-model' }),
  isProviderConfigured: () => true,
  getProviderName: () => 'Test Provider',
  providerNotConfiguredMessage: (providerId: string) =>
    `Provider "${providerId}" is not configured (test stub)`,
}))
mock.module('@/lib/ai/agent-model-registry', () => ({
  DEFAULT_AGENT_MODEL: 'test/test-model',
  resolveDefaultAgentModel: () => 'test/test-model',
  isFreeAgentModel: () => false,
}))
mock.module('@/lib/ai/anyrouter-dynamic-models', () => ({
  isAnyRouterAutoModelId: () => false,
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
  throw new Error('no clerk owner')
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
mock.module('@/lib/billing/entitlements', () => ({
  checkAiDailyLimit: () => ({ allowed: true }),
  checkAiBudget: () => ({ allowed: true }),
  limitMessage: () => 'limit reached',
}))
mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage: async () => 1,
  releaseAiUsage: async () => {},
  getAiSpendThisMonth: async () => 0,
  meterAiOverage: async () => {},
  recordByokActivation: async () => {},
}))

const createClickHouseAgent = mock(() => {
  throw new Error('boom: stop after gates')
})
mock.module('@/lib/ai/agent', () => ({ createClickHouseAgent }))

const { Route } = await import('@/routes/api/v1/agent')

function getHandler(): (ctx: { request: Request }) => Promise<Response> {
  return (
    Route.options as unknown as {
      server: {
        handlers: {
          POST: (ctx: { request: Request }) => Promise<Response>
        }
      }
    }
  ).server.handlers.POST
}

async function postAgent(): Promise<Response> {
  return getHandler()({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello', model: 'test/test-model' }),
    }),
  })
}

describe('POST /api/v1/agent — cloud guest identity rate limit', () => {
  beforeEach(() => {
    cloudMode = false
    checkRateLimitDurable.mockClear()
    createClickHouseAgent.mockClear()
  })

  test('cloud guest uses agent:guest:<ownerId> at the guest per-min limit', async () => {
    cloudMode = true
    const guestOwnerId = await guestOwnerIdFromIp('203.0.113.9')

    await postAgent()

    expect(checkRateLimitDurable.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(checkRateLimitDurable.mock.calls[0]?.[0]).toBe(
      'agent:ip:203.0.113.9'
    )
    expect(checkRateLimitDurable.mock.calls[0]?.[1]).toBe(10)

    const guestCall = checkRateLimitDurable.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0] as string).startsWith('agent:guest:')
    )
    expect(guestCall).toBeDefined()
    expect(guestCall?.[0]).toBe(`agent:guest:${guestOwnerId}`)
    expect(guestCall?.[1]).toBe(5)
  })

  test('OSS guest does not add a per-guest identity bucket', async () => {
    cloudMode = false

    await postAgent()

    const guestCall = checkRateLimitDurable.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0] as string).startsWith('agent:guest:')
    )
    expect(guestCall).toBeUndefined()
    expect(checkRateLimitDurable).toHaveBeenCalledTimes(1)
    expect(checkRateLimitDurable.mock.calls[0]?.[0]).toBe(
      'agent:ip:203.0.113.9'
    )
  })
})
