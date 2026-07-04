import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mock pattern as webhook.test.ts — see that file's comment
// for why this mocks the full export surface of feature-permissions/server.
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

const OPSGENIE_ENV_KEYS = [
  'HEALTH_ALERT_OPSGENIE_API_KEY',
  'HEALTH_ALERT_OPSGENIE_REGION',
] as const

const { __handleGetForTests: handleGet, __handlePostForTests: handlePost } =
  await import('./opsgenie-test')

const originalEnv: Record<string, string | undefined> = {}
for (const key of OPSGENIE_ENV_KEYS) originalEnv[key] = process.env[key]

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  for (const key of OPSGENIE_ENV_KEYS) delete process.env[key]
})

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/health/opsgenie-test', {
    method: 'POST',
  })
}

describe('GET /api/v1/health/opsgenie-test', () => {
  test('reports not configured when no API key is set', async () => {
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean; region: null }
    expect(body).toEqual({ configured: false, region: null })
  })

  test('reports configured with region when an API key is set', async () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'my-key'
    process.env.HEALTH_ALERT_OPSGENIE_REGION = 'eu'
    const res = await handleGet()
    const body = (await res.json()) as {
      configured: boolean
      region: string
    }
    expect(body).toEqual({ configured: true, region: 'eu' })
  })
})

describe('POST /api/v1/health/opsgenie-test — auth gate', () => {
  test('anonymous is blocked, no egress', async () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'my-key'
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const fetchImpl = mock(async () => new Response('ok', { status: 200 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/health/opsgenie-test — dispatch', () => {
  test('400s when Opsgenie is not configured', async () => {
    const fetchImpl = mock(async () => new Response('ok', { status: 200 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: async () => ['93.184.216.34'],
    })

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sends a real test dispatch when configured', async () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'my-key'
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 202 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: async () => ['93.184.216.34'],
    })

    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.opsgenie.com/v2/alerts')
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'GenieKey my-key'
    )
  })

  test('502s when the Opsgenie request fails', async () => {
    process.env.HEALTH_ALERT_OPSGENIE_API_KEY = 'my-key'
    const fetchImpl = mock(async () => new Response('nope', { status: 500 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: async () => ['93.184.216.34'],
    })

    expect(res.status).toBe(502)
  })
})
