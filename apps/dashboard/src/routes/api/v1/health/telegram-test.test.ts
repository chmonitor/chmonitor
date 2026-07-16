import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mock pattern as opsgenie-test.test.ts / webhook.test.ts.
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

const TELEGRAM_ENV_KEYS = [
  'HEALTH_ALERT_TELEGRAM_BOT_TOKEN',
  'HEALTH_ALERT_TELEGRAM_CHAT_ID',
] as const

const { __handleGetForTests: handleGet, __handlePostForTests: handlePost } =
  await import('./telegram-test')

const originalEnv: Record<string, string | undefined> = {}
for (const key of TELEGRAM_ENV_KEYS) originalEnv[key] = process.env[key]

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  for (const key of TELEGRAM_ENV_KEYS) delete process.env[key]
})

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/health/telegram-test', {
    method: 'POST',
  })
}

describe('GET /api/v1/health/telegram-test', () => {
  test('reports not configured when no bot token/chat id is set', async () => {
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: false })
  })

  test('reports not configured when only the token is set', async () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = 'tok'
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: false })
  })

  test('reports configured when both token and chat id are set', async () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = 'tok'
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '-100'
    const res = await handleGet()
    const body = (await res.json()) as { configured: boolean }
    expect(body).toEqual({ configured: true })
  })
})

describe('POST /api/v1/health/telegram-test — auth gate', () => {
  test('anonymous is blocked, no egress', async () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = 'tok'
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '-100'
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

describe('POST /api/v1/health/telegram-test — dispatch', () => {
  test('400s when Telegram is not configured', async () => {
    const fetchImpl = mock(async () => new Response('ok', { status: 200 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sends a real test dispatch when configured', async () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = '123:ABC'
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '-100'
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 200 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage')
  })

  test('502s when the Telegram request fails', async () => {
    process.env.HEALTH_ALERT_TELEGRAM_BOT_TOKEN = '123:ABC'
    process.env.HEALTH_ALERT_TELEGRAM_CHAT_ID = '-100'
    const fetchImpl = mock(async () => new Response('nope', { status: 400 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(502)
  })
})
