import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mock pattern as telegram-test.test.ts / webhook.test.ts.
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

const NTFY_ENV_KEYS = [
  'HEALTH_ALERT_NTFY_URL',
  'HEALTH_ALERT_NTFY_TOKEN',
] as const

const { __handleGetForTests: handleGet, __handlePostForTests: handlePost } =
  await import('./ntfy-test')

const originalEnv: Record<string, string | undefined> = {}
for (const key of NTFY_ENV_KEYS) originalEnv[key] = process.env[key]

const resolvePublic = async () => ['93.184.216.34']
const resolvePrivate = async () => ['10.0.0.5']

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  for (const key of NTFY_ENV_KEYS) delete process.env[key]
})

function makeRequest(body?: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/ntfy-test', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}

describe('GET /api/v1/health/ntfy-test', () => {
  test('reports not configured when no URL is set', async () => {
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: false })
  })

  test('reports configured when the URL is set', async () => {
    process.env.HEALTH_ALERT_NTFY_URL = 'https://ntfy.sh/my-topic'
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: true })
  })
})

describe('POST /api/v1/health/ntfy-test — auth gate', () => {
  test('anonymous is blocked, no egress', async () => {
    process.env.HEALTH_ALERT_NTFY_URL = 'https://ntfy.sh/my-topic'
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/health/ntfy-test — env-global mode', () => {
  test('400s when ntfy is not configured', async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sends a real test dispatch to the env topic when configured', async () => {
    process.env.HEALTH_ALERT_NTFY_URL = 'https://ntfy.sh/my-topic'
    process.env.HEALTH_ALERT_NTFY_TOKEN = 'tk_secret'
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://ntfy.sh/my-topic')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tk_secret')
  })

  test('502s when the ntfy request fails', async () => {
    process.env.HEALTH_ALERT_NTFY_URL = 'https://ntfy.sh/my-topic'
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('nope', { status: 403 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(502)
  })
})

describe('POST /api/v1/health/ntfy-test — ad-hoc mode', () => {
  test('dispatches to a caller-supplied public HTTPS topic', async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(
      makeRequest({ url: 'https://ntfy.example.com/topic', token: 'tk_1' }),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveHostAddresses: resolvePublic,
      }
    )

    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://ntfy.example.com/topic')
  })

  test('rejects a non-HTTPS ad-hoc URL, no egress', async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(makeRequest({ url: 'http://ntfy.sh/topic' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: resolvePublic,
    })

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('blocks an SSRF-unsafe (private) ad-hoc URL, no egress', async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(
      makeRequest({ url: 'https://internal.local/topic' }),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveHostAddresses: resolvePrivate,
      }
    )

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
