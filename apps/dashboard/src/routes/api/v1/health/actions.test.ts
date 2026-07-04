/**
 * Tests for routes/api/v1/health/actions.ts
 *
 * Covers the invariants plans/33-remediation-action-links.md exists to
 * protect:
 *   - auth-gated like the other mutating health routes
 *   - unknown rule / unknown action → 400
 *   - runbook action → returns the URL, never touches the cluster
 *   - diagnostic action → executes the rule's OWN sql via the read-only
 *     transport (readonly=1), capped rows, client-supplied actionId never
 *     carries SQL
 *   - a rule with a non-read-only diagnostic (bypassing declaration-time
 *     validation, e.g. a buggy plugin) is rejected with 422 at request time too
 *
 * Mocking strategy mirrors routes/api/v1/health/webhook.test.ts and
 * routes/api/v1/__tests__/actions.test.ts: mock.module() for cloudflare:workers,
 * feature-permissions/server, server-env, @chm/logger, @chm/clickhouse-client —
 * all declared before the dynamic import of the Route module.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

let authorizeFeatureRequest = mock(
  async (
    _permission: unknown,
    _request: Request,
    _options?: { allowAgentBearerToken?: boolean }
  ): Promise<Response | null> => null
)
mock.module('@/lib/feature-permissions/server', () => ({
  getAppConfig: () => ({ authProvider: 'none' as const, features: {} }),
  _resetAppConfigCache: () => {},
  publicReadEnabled: () => true,
  authorizeFeatureRequest: (
    permission: unknown,
    request: Request,
    options?: { allowAgentBearerToken?: boolean }
  ) => authorizeFeatureRequest(permission, request, options),
}))

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
}))

mock.module('@chm/logger', () => ({
  debug: mock(() => undefined),
  error: mock(() => undefined),
}))

const mockFetchData = mock(
  async (
    _args: unknown
  ): Promise<{
    data: Array<Record<string, unknown>> | null
    error: { message: string } | null
  }> => ({ data: [], error: null })
)
mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

const { __handlePostForTests: handlePost } = await import('./actions')
const { ruleRegistry } = await import('@/lib/alerting/rule-registry')

function makeRequest(body: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  mockFetchData.mockClear()
  mockFetchData.mockImplementation(async () => ({ data: [], error: null }))

  ruleRegistry.unregister('test-rule')
  ruleRegistry.register({
    id: 'test-rule',
    type: 'custom',
    title: 'Test Rule',
    description: 'test',
    valueKey: 'v',
    defaults: { warning: 1, critical: 5 },
    remediationActions: [
      {
        id: 'my-runbook',
        label: 'Runbook',
        kind: 'runbook',
        url: 'https://docs.example.com/runbook',
      },
      {
        id: 'my-diagnostic',
        label: 'Diagnostic',
        kind: 'diagnostic',
        sql: 'SELECT * FROM system.mutations',
      },
    ],
  })
})

describe('health actions — auth gate', () => {
  test('anonymous caller is blocked', async () => {
    authorizeFeatureRequest = mock(
      async () => new Response('unauthorized', { status: 401 })
    )
    const res = await handlePost(
      makeRequest({ hostId: 0, ruleId: 'test-rule', actionId: 'my-runbook' })
    )
    expect(res.status).toBe(401)
    expect(mockFetchData).not.toHaveBeenCalled()
  })
})

describe('health actions — validation', () => {
  test('missing fields → 400', async () => {
    const res = await handlePost(makeRequest({}))
    expect(res.status).toBe(400)
  })

  test('unknown rule → 400', async () => {
    const res = await handlePost(
      makeRequest({ hostId: 0, ruleId: 'nope', actionId: 'x' })
    )
    expect(res.status).toBe(400)
  })

  test('unknown action → 400', async () => {
    const res = await handlePost(
      makeRequest({ hostId: 0, ruleId: 'test-rule', actionId: 'nope' })
    )
    expect(res.status).toBe(400)
  })
})

describe('health actions — runbook', () => {
  test('returns the url and never touches the cluster', async () => {
    const res = await handlePost(
      makeRequest({ hostId: 0, ruleId: 'test-rule', actionId: 'my-runbook' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      kind: 'runbook',
      url: 'https://docs.example.com/runbook',
    })
    expect(mockFetchData).not.toHaveBeenCalled()
  })
})

describe('health actions — diagnostic', () => {
  test('executes the rule-declared SQL read-only and returns capped rows', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: Array.from({ length: 60 }, (_, i) => ({ n: i })),
      error: null,
    }))

    const res = await handlePost(
      makeRequest({
        hostId: 3,
        ruleId: 'test-rule',
        actionId: 'my-diagnostic',
      })
    )
    expect(res.status).toBe(200)

    expect(mockFetchData).toHaveBeenCalledTimes(1)
    const call = mockFetchData.mock.calls[0][0] as {
      query: string
      hostId: number
      clickhouse_settings?: Record<string, string>
    }
    // The SQL is the rule's own declared SQL, never anything from the request.
    expect(call.query).toBe('SELECT * FROM system.mutations')
    expect(call.hostId).toBe(3)
    expect(call.clickhouse_settings?.readonly).toBe('1')

    const body = (await res.json()) as {
      success: boolean
      kind: string
      rows: unknown[]
      rowCount: number
      truncated: boolean
    }
    expect(body.success).toBe(true)
    expect(body.kind).toBe('diagnostic')
    expect(body.rows).toHaveLength(50)
    expect(body.rowCount).toBe(60)
    expect(body.truncated).toBe(true)
  })

  test('a ClickHouse error surfaces as a sanitized 500, not a crash', async () => {
    mockFetchData.mockImplementation(async () => ({
      data: null,
      error: { message: 'Code: 60. Table system.secret_table does not exist' },
    }))
    const res = await handlePost(
      makeRequest({
        hostId: 0,
        ruleId: 'test-rule',
        actionId: 'my-diagnostic',
      })
    )
    expect(res.status).toBe(500)
  })

  test('client cannot smuggle SQL through actionId — a request-time destructive rule is rejected with 422', async () => {
    ruleRegistry.unregister('bad-rule')
    ruleRegistry.register({
      id: 'bad-rule',
      type: 'custom',
      title: 'Bad Rule',
      description: 'test',
      valueKey: 'v',
      defaults: { warning: 1, critical: 5 },
      // Simulates a buggy plugin rule that slipped past declaration-time
      // validation — the endpoint's own defense-in-depth check must still
      // reject it.
      remediationActions: [
        {
          id: 'evil',
          label: 'Evil',
          kind: 'diagnostic',
          sql: 'ALTER TABLE foo DELETE WHERE 1',
        },
      ],
    })

    const res = await handlePost(
      makeRequest({ hostId: 0, ruleId: 'bad-rule', actionId: 'evil' })
    )
    expect(res.status).toBe(422)
    expect(mockFetchData).not.toHaveBeenCalled()

    ruleRegistry.unregister('bad-rule')
  })
})
