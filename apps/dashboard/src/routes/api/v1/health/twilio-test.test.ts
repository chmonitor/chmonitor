import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mock pattern as telegram-test.test.ts / opsgenie-test.test.ts.
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

const TWILIO_ENV_KEYS = [
  'HEALTH_ALERT_TWILIO_ACCOUNT_SID',
  'HEALTH_ALERT_TWILIO_AUTH_TOKEN',
  'HEALTH_ALERT_TWILIO_FROM',
  'HEALTH_ALERT_TWILIO_TO',
  'HEALTH_ALERT_TWILIO_MIN_SEVERITY',
] as const

const { __handleGetForTests: handleGet, __handlePostForTests: handlePost } =
  await import('./twilio-test')

const originalEnv: Record<string, string | undefined> = {}
for (const key of TWILIO_ENV_KEYS) originalEnv[key] = process.env[key]

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  for (const key of TWILIO_ENV_KEYS) delete process.env[key]
})

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/health/twilio-test', {
    method: 'POST',
  })
}

function configureTwilio() {
  process.env.HEALTH_ALERT_TWILIO_ACCOUNT_SID = 'ACtest1234'
  process.env.HEALTH_ALERT_TWILIO_AUTH_TOKEN = 'secret-token'
  process.env.HEALTH_ALERT_TWILIO_FROM = '+15557654321'
  process.env.HEALTH_ALERT_TWILIO_TO = '+15551234567,+15559876543'
}

describe('GET /api/v1/health/twilio-test', () => {
  test('reports not configured when nothing is set', async () => {
    const res = await handleGet()
    const body = (await res.json()) as {
      configured: boolean
      recipients: number
    }
    expect(body).toEqual({ configured: false, recipients: 0 })
  })

  test('reports not configured when only some vars are set', async () => {
    process.env.HEALTH_ALERT_TWILIO_ACCOUNT_SID = 'ACtest1234'
    process.env.HEALTH_ALERT_TWILIO_AUTH_TOKEN = 'secret-token'
    const res = await handleGet()
    const body = (await res.json()) as {
      configured: boolean
      recipients: number
    }
    expect(body).toEqual({ configured: false, recipients: 0 })
  })

  test('reports configured with the recipient count when fully set', async () => {
    configureTwilio()
    const res = await handleGet()
    const body = (await res.json()) as {
      configured: boolean
      recipients: number
    }
    expect(body).toEqual({ configured: true, recipients: 2 })
  })
})

describe('POST /api/v1/health/twilio-test — auth gate', () => {
  test('anonymous is blocked, no egress', async () => {
    configureTwilio()
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const fetchImpl = mock(async () => new Response('ok', { status: 201 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/health/twilio-test — dispatch', () => {
  test('400s when Twilio is not configured', async () => {
    const fetchImpl = mock(async () => new Response('ok', { status: 201 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sends a real test SMS (Basic auth, form-encoded) when configured', async () => {
    configureTwilio()
    const fetchImpl = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response('ok', { status: 201 })
    )
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(200)
    // One POST per configured recipient.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACtest1234/Messages.json'
    )
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa('ACtest1234:secret-token')}`
    )
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    )
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('From')).toBe('+15557654321')
  })

  test('502s when every Twilio request fails', async () => {
    configureTwilio()
    const fetchImpl = mock(async () => new Response('nope', { status: 400 }))
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(res.status).toBe(502)
  })
})
