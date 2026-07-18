/**
 * Auth / validation / masking tests for the unified alert channel config API
 * (#2665). The store + owner resolution are mocked so this file stays hermetic
 * (no D1, no Clerk) and focuses on the route's own contract:
 *   - writes require the `settings` feature auth gate (same as webhook.ts)
 *   - cloud-anon writes are rejected by `requiresSignInForWrite`
 *   - the secret is never returned in full (masked, last 4 chars)
 *   - an invalid channel / non-HTTPS URL is a 400
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Auth gate — same mock surface as webhook.test.ts / opsgenie-test.test.ts.
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

// Owner resolution — self-hosted single-tenant by default; write gate off.
let requiresSignIn = false
mock.module('@/lib/health/alert-routing-auth', () => ({
  SINGLE_TENANT_OWNER_ID: '',
  resolveAlertRoutingOwnerId: async () => '',
  requiresSignInForWrite: () => requiresSignIn,
}))

// Store — controllable in-memory doubles + the REAL channel validator.
const ALL_CHANNELS = [
  'webhook',
  'healthchecks',
  'email',
  'opsgenie',
  'telegram',
  'ntfy',
  'pushover',
  'twilio',
]
let listResult: unknown[] = []
let upsertResult: unknown = null
const upsertCalls: unknown[] = []
mock.module('@/lib/health/alert-channel-config-store', () => ({
  isAlertConfigChannel: (v: unknown) =>
    typeof v === 'string' && ALL_CHANNELS.includes(v),
  listChannelConfigs: async () => listResult,
  upsertChannelConfig: async (input: unknown) => {
    upsertCalls.push(input)
    return upsertResult
  },
  deleteChannelConfig: async () => true,
}))

const { __handleGetForTests: handleGet, __handlePutForTests: handlePut } =
  await import('./alert-config')

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  requiresSignIn = false
  listResult = []
  upsertResult = null
  upsertCalls.length = 0
})

function putRequest(body: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/alert-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/v1/health/alert-config', () => {
  test('masks the secret (last 4 only) and reports hasSecret', async () => {
    listResult = [
      {
        channel: 'opsgenie',
        enabled: true,
        minSeverity: 'critical',
        target: { region: 'eu' },
        secret: 'super-secret-key-9999',
        updatedAt: 5,
      },
    ]
    const res = await handleGet()
    const body = (await res.json()) as {
      configs: {
        channel: string
        hasSecret: boolean
        secretMasked: string | null
        target: Record<string, string>
      }[]
    }
    const cfg = body.configs[0]
    expect(cfg.channel).toBe('opsgenie')
    expect(cfg.hasSecret).toBe(true)
    expect(cfg.secretMasked).toBe('••••9999')
    // The raw secret never appears anywhere in the response.
    expect(JSON.stringify(body)).not.toContain('super-secret-key-9999')
    // Non-secret target fields are returned as-is.
    expect(cfg.target).toEqual({ region: 'eu' })
  })

  test('reports which channels are env-configured without leaking secrets', async () => {
    const res = await handleGet()
    const body = (await res.json()) as { env: Record<string, boolean> }
    expect(typeof body.env.opsgenie).toBe('boolean')
    expect(typeof body.env.webhook).toBe('boolean')
  })
})

describe('PUT /api/v1/health/alert-config — auth + validation', () => {
  test('anonymous (auth gate) is rejected, no upsert', async () => {
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const res = await handlePut(
      putRequest({ channel: 'opsgenie', enabled: true })
    )
    expect(res.status).toBe(401)
    expect(upsertCalls).toHaveLength(0)
  })

  test('cloud-anon write is rejected by requiresSignInForWrite', async () => {
    requiresSignIn = true
    const res = await handlePut(
      putRequest({ channel: 'opsgenie', enabled: true })
    )
    expect(res.status).toBe(401)
    expect(upsertCalls).toHaveLength(0)
  })

  test('an unknown channel is a 400', async () => {
    const res = await handlePut(
      putRequest({ channel: 'pigeon', enabled: true })
    )
    expect(res.status).toBe(400)
    expect(upsertCalls).toHaveLength(0)
  })

  test('a non-HTTPS webhook URL is a 400 (SSRF-adjacent guard)', async () => {
    const res = await handlePut(
      putRequest({
        channel: 'webhook',
        enabled: true,
        target: { url: 'http://insecure.example/hook' },
      })
    )
    expect(res.status).toBe(400)
    expect(upsertCalls).toHaveLength(0)
  })

  test('a valid opsgenie upsert returns the masked saved config', async () => {
    upsertResult = {
      channel: 'opsgenie',
      enabled: true,
      minSeverity: 'critical',
      target: { region: 'us' },
      secret: 'abcd-1234',
      updatedAt: 9,
    }
    const res = await handlePut(
      putRequest({
        channel: 'opsgenie',
        enabled: true,
        minSeverity: 'critical',
        target: { region: 'us' },
        secret: 'abcd-1234',
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      config: { secretMasked: string; hasSecret: boolean }
    }
    expect(body.success).toBe(true)
    expect(body.config.secretMasked).toBe('••••1234')
    // The upsert received the parsed input.
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toMatchObject({
      channel: 'opsgenie',
      enabled: true,
      minSeverity: 'critical',
    })
  })

  test('a store failure (no D1) surfaces as 501', async () => {
    upsertResult = null
    const res = await handlePut(
      putRequest({
        channel: 'telegram',
        enabled: true,
        target: { chatId: '-1' },
      })
    )
    expect(res.status).toBe(501)
  })
})
