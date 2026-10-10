/**
 * POST /api/v1/agent on a signed-in cloud user's OWN connection (negative
 * host id). Before, the id was clamped to 0 and the agent answered from the
 * hidden demo host; then it was refused outright, leaving signed-in cloud
 * users with no agent. Now:
 *
 * - own connection → the agent is built for that host id, bound to that
 *   connection, and its tools query the connection (never env host 0);
 * - another user's id → 404, nothing is built;
 * - a guest, a browser-stored id, or a Postgres connection → 400.
 *
 * The real route, request parsing, demo-host rule and connection resolver
 * run; the connection store and ClickHouse clients are mocked.
 * `createClickHouseAgent`
 * records its options and throws to stop before streaming; the test then runs
 * the REAL tools with those options.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realClient from '@chm/clickhouse-client'

mock.module('cloudflare:workers', () => ({ env: {} }))

mock.module('@/lib/cloud/cloud-mode', () => ({
  isCloudModeServer: () => true,
  isCloudModeClient: () => true,
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
  getGuestAiRateLimitPerMin: () => 5,
  RATE_LIMIT_BINDING_AGENT: 'AGENT_RL',
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
}))
mock.module('@/lib/api/server-env', () => ({ bridgeClickHouseEnv: () => {} }))
mock.module('@/lib/auth/agent-api-auth', () => ({
  authorizeAgentApiRequest: async () => null,
}))

let signedInUser: string | null = null
mock.module('@/lib/auth/provider', () => ({
  isClerkAuthProvider: () => true,
  getAuthProvider: () => 'clerk',
  parseAuthProvider: () => 'clerk',
}))
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: signedInUser }),
}))
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
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
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: async () => ({ type: 'user' as const, id: 'x' }),
  resolveBillingOwnerId: async () => 'unused',
}))
mock.module('@/lib/billing/user-subscription', () => ({
  getPlanForOwner: async () => ({
    id: 'free',
    aiRequestsPerDay: 5,
    aiMonthlyUsdBudget: null,
  }),
}))
mock.module('@/lib/billing/ai-usage-store', () => ({
  reserveAiUsage: async () => 1,
  releaseAiUsage: async () => {},
  getAiSpendThisMonth: async () => 0,
  meterAiOverage: async () => {},
  recordByokActivation: async () => {},
}))
mock.module('@/lib/ai/agent/user-token-store', () => ({
  getUserProviderToken: async () => null,
}))

// Connection store: user_a owns -1000 (ClickHouse) and -1001 (Postgres);
// user_b owns -1002.
const CONNECTIONS = [
  { id: 'a-ch', userId: 'user_a', hostId: -1000, engine: 'clickhouse' },
  { id: 'a-pg', userId: 'user_a', hostId: -1001, engine: 'postgres' },
  { id: 'b-ch', userId: 'user_b', hostId: -1002, engine: 'clickhouse' },
]
mock.module('@/lib/connection-store/server-feature', () => ({
  getUserConnectionsServerConfig: () => ({ dbStorageEnabled: true }),
}))
mock.module('@/lib/connection-store/resolve-store', () => ({
  resolveConnectionStore: async () => ({
    list: async (userId: string) =>
      CONNECTIONS.filter((c) => c.userId === userId).map((c) => ({
        ...c,
        name: c.id,
        hostUrl: `https://${c.id}.example.com`,
        chUser: 'default',
        createdAt: 0,
        updatedAt: 0,
      })),
    getCredentials: async (userId: string, id: string) => {
      const c = CONNECTIONS.find((x) => x.id === id && x.userId === userId)
      return c
        ? { host: `https://${c.id}.example.com`, user: 'default', password: '' }
        : null
    },
  }),
}))

const fetchData = mock(async () => ({ data: [{ host: 'env' }], error: null }))
mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))
const connectionQueries: Array<{ host: string; settings: unknown }> = []
mock.module('@/lib/connection-query/connection-client', () => ({
  createConnectionClient: (creds: { host: string }) => ({
    query: async (args: { clickhouse_settings?: unknown }) => {
      connectionQueries.push({
        host: creds.host,
        settings: args.clickhouse_settings,
      })
      return { json: async () => [{ host: creds.host }] }
    },
    close: async () => {},
  }),
}))

const { createAllTools } = await import('@/lib/ai/agent/tools')

type AgentOpts = {
  hostId: number
  connection?: Parameters<typeof createAllTools>[2]
}
const createClickHouseAgent = mock((_opts: AgentOpts) => {
  throw new Error('boom: stop after building the agent')
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

function send(hostId: unknown): Promise<Response> {
  return post({
    request: new Request('http://localhost/api/v1/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'hello',
        hostId,
        model: 'anyrouter:openai/gpt-5',
      }),
    }),
  })
}

beforeEach(() => {
  process.env.ANYROUTER_API_KEY = 'deployment-key-000000'
  signedInUser = 'user_a'
  createClickHouseAgent.mockClear()
  fetchData.mockClear()
  connectionQueries.length = 0
})

describe('POST /api/v1/agent — own connection in cloud mode', () => {
  test('signed-in user on their own connection: agent bound to it, tools query it', async () => {
    await send(-1000)
    expect(createClickHouseAgent).toHaveBeenCalledTimes(1)
    const opts = createClickHouseAgent.mock.calls[0][0]
    expect(opts.hostId).toBe(-1000)
    expect(opts.connection?.connectionId).toBe('a-ch')
    expect(opts.connection?.userId).toBe('user_a')

    // Run the query tool the way the agent would, with those options: it goes
    // to the user's connection, read-only, never to the env/demo host.
    const tools = createAllTools(
      opts.hostId,
      false,
      opts.connection
    ) as unknown as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >
    const result = await tools.query.execute({ sql: 'SELECT 1' })
    expect(JSON.stringify(result)).toContain('https://a-ch.example.com')
    expect(connectionQueries).toHaveLength(1)
    expect(connectionQueries[0].settings).toMatchObject({ readonly: '2' })
    expect(fetchData).not.toHaveBeenCalled()
  })

  test("another user's connection id is 404 and nothing is built", async () => {
    const res = await send(-1002)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('CONNECTION_NOT_FOUND')
    expect(createClickHouseAgent).not.toHaveBeenCalled()
    expect(fetchData).not.toHaveBeenCalled()
    expect(connectionQueries).toHaveLength(0)
  })

  test('a Postgres connection or a browser-stored id is a 400', async () => {
    for (const [hostId, reason] of [
      [-1001, 'unsupported_engine'],
      [-1, 'browser_connection'],
    ] as const) {
      const res = await send(hostId)
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { reason: string } }
      expect(body.error.reason).toBe(reason)
    }
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('a guest cannot use a negative id (never clamped to the demo host)', async () => {
    signedInUser = null
    const res = await send(-1000)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { reason: string } }
    expect(body.error.reason).toBe('not_signed_in')
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })

  test('signed-in user on the demo host 0 is still blocked', async () => {
    const res = await send(0)
    expect(res.status).toBe(403)
    expect(createClickHouseAgent).not.toHaveBeenCalled()
  })
})
