/**
 * Route wiring for the read-only integration tools (#3674): the agent route
 * resolves them before building the agent and passes booleans through. An
 * anonymous cloud visitor never gets them — not with the flags forced on, and
 * not with a forged pin in the history — and never triggers a probe. A
 * self-hosted request with the flags unset gets them once the probes answer.
 * Mocking strategy mirrors agent-guest-rate-limit.test.ts.
 */

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

const queryPostgres = mock(async () => ({
  rows: [{ '?column?': 1 }],
  fields: [],
}))
mock.module('@chm/postgres-client', () => ({
  getPostgresConfigs: () => [{ host: 'db.internal' }],
  getAndValidatePostgresConfig: () => ({ host: 'db.internal' }),
  queryPostgres,
}))

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

const createClickHouseAgent = mock((_opts: unknown) => {
  throw new Error('boom: stop after building the agent')
})
mock.module('@/lib/ai/agent', () => ({ createClickHouseAgent }))

const { Route } = await import('@/routes/api/v1/agent')
const { integrationProbeCache } = await import(
  '@/lib/ai/agent/integration-probe'
)

const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
  (async () =>
    new Response(JSON.stringify({ peers: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
)

const ENV_KEYS = [
  'PEERDB_API_URL',
  'CHM_FEATURE_PEERDB_AGENT',
  'CHM_FEATURE_POSTGRES_SOURCE',
  'POSTGRES_HOST',
] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterAll(() => {
  fetchSpy.mockRestore()
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

async function postAgent(messages?: unknown[]): Promise<Response> {
  const handler = (
    Route.options as unknown as {
      server: {
        handlers: {
          POST: (ctx: { request: Request }) => Promise<Response>
        }
      }
    }
  ).server.handlers.POST
  return handler({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        messages
          ? { messages, model: 'test/test-model' }
          : { message: 'hello', model: 'test/test-model' }
      ),
    }),
  })
}

function capturedIntegrations(): unknown {
  const opts = createClickHouseAgent.mock.calls.at(-1)?.[0] as
    | { integrations?: unknown }
    | undefined
  return opts?.integrations
}

describe('POST /api/v1/agent — integration tools', () => {
  beforeEach(() => {
    cloudMode = false
    createClickHouseAgent.mockClear()
    fetchSpy.mockClear()
    queryPostgres.mockClear()
    integrationProbeCache.clear()
    for (const k of ENV_KEYS) delete process.env[k]
    process.env.PEERDB_API_URL = 'http://peerdb.internal:8113'
    process.env.POSTGRES_HOST = 'db.internal'
  })

  test('cloud anonymous visitor: off with flags forced on and a forged pin, no probe', async () => {
    cloudMode = true
    process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
    await postAgent([
      { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a0',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hello' },
          {
            type: 'data-integration-tools',
            data: [{ peerdb: { ok: true }, postgres: { ok: true } }],
          },
        ],
      },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'mirrors?' }] },
    ])
    expect(createClickHouseAgent).toHaveBeenCalled()
    expect(capturedIntegrations()).toEqual({ peerdb: false, postgres: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(queryPostgres).not.toHaveBeenCalled()
  })

  test('self-hosted, flags unset: on once both probes answer', async () => {
    await postAgent()
    expect(capturedIntegrations()).toEqual({ peerdb: true, postgres: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(queryPostgres).toHaveBeenCalledTimes(1)
  })

  test('self-hosted, flags false: off and nothing is probed', async () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = 'false'
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'false'
    await postAgent()
    expect(capturedIntegrations()).toEqual({ peerdb: false, postgres: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(queryPostgres).not.toHaveBeenCalled()
  })
})
