import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mock pattern as ntfy-test.test.ts / telegram-test.test.ts.
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

const PUSHOVER_ENV_KEYS = [
  'HEALTH_ALERT_PUSHOVER_TOKEN',
  'HEALTH_ALERT_PUSHOVER_USER',
] as const

const { __handleGetForTests: handleGet, __handlePostForTests: handlePost } =
  await import('./pushover-test')

const originalEnv: Record<string, string | undefined> = {}
for (const key of PUSHOVER_ENV_KEYS) originalEnv[key] = process.env[key]

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  for (const key of PUSHOVER_ENV_KEYS) delete process.env[key]
})

function makeRequest(body?: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/pushover-test', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}

describe('GET /api/v1/health/pushover-test', () => {
  test('reports not configured when neither var is set', async () => {
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: false })
  })

  test('reports not configured when only the token is set', async () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = 'app_tok'
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: false })
  })

  test('reports configured when both token and user are set', async () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = 'app_tok'
    process.env.HEALTH_ALERT_PUSHOVER_USER = 'usr_key'
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: true })
  })
})

describe('POST /api/v1/health/pushover-test — auth gate', () => {
  test('anonymous is blocked, no egress', async () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = 'app_tok'
    process.env.HEALTH_ALERT_PUSHOVER_USER = 'usr_key'
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

describe('POST /api/v1/health/pushover-test — env-global mode', () => {
  test('400s when Pushover is not configured', async () => {
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

  test('sends a real test dispatch to the env recipient when configured', async () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = 'app_tok'
    process.env.HEALTH_ALERT_PUSHOVER_USER = 'usr_key'
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
    expect(url).toBe('https://api.pushover.net/1/messages.json')
    const parsed = JSON.parse(String((init as RequestInit).body)) as {
      token: string
      user: string
    }
    expect(parsed.token).toBe('app_tok')
    expect(parsed.user).toBe('usr_key')
  })

  test('502s when the Pushover request fails', async () => {
    process.env.HEALTH_ALERT_PUSHOVER_TOKEN = 'app_tok'
    process.env.HEALTH_ALERT_PUSHOVER_USER = 'usr_key'
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

describe('POST /api/v1/health/pushover-test — ad-hoc mode', () => {
  test('dispatches to a caller-supplied token + user', async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(
      makeRequest({ token: 'ad_hoc_tok', user: 'ad_hoc_usr' }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0]
    const parsed = JSON.parse(String((init as RequestInit).body)) as {
      token: string
      user: string
    }
    expect(parsed.token).toBe('ad_hoc_tok')
    expect(parsed.user).toBe('ad_hoc_usr')
  })

  test('rejects an ad-hoc token without a user, no egress', async () => {
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(makeRequest({ token: 'ad_hoc_tok' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
