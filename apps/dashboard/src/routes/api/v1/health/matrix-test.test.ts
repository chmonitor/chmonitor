import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mock pattern as ntfy-test.test.ts.
let authorizeFeatureRequest = mock(
  async (
    _permission: unknown,
    _request: Request,
    _options?: { allowAgentBearerToken?: boolean }
  ): Promise<Response | null> => null
)
const realModule = { ...(await import('@/lib/feature-permissions/server')) }

mock.module('@/lib/feature-permissions/server', () => ({
  ...realModule,
  getAppConfig: () => ({ authProvider: 'none' as const, features: {} }),
  _resetAppConfigCache: () => {},
  publicReadEnabled: () => true,
  authorizeFeatureRequest: (
    permission: unknown,
    request: Request,
    options?: { allowAgentBearerToken?: boolean }
  ) => authorizeFeatureRequest(permission, request, options),
}))

// Restore the real modules so these mocks never leak into other test files.
afterAll(() => {
  mock.module('@/lib/feature-permissions/server', () => ({ ...realModule }))
})

const MATRIX_ENV_KEYS = [
  'HEALTH_ALERT_MATRIX_HOMESERVER_URL',
  'HEALTH_ALERT_MATRIX_ACCESS_TOKEN',
  'HEALTH_ALERT_MATRIX_ROOM_ID',
] as const

const { __handleGetForTests: handleGet, __handlePostForTests: handlePost } =
  await import('./matrix-test')

const resolvePublic = async () => ['93.184.216.34']
const resolvePrivate = async () => ['10.0.0.5']

const AD_HOC = {
  homeserverUrl: 'https://matrix.example.org',
  accessToken: 'syt_secret',
  roomId: '!abc:example.org',
}

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  for (const key of MATRIX_ENV_KEYS) delete process.env[key]
})

function makeRequest(body?: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/matrix-test', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  })
}

function okFetch() {
  return mock(
    async (_url: string, _init?: RequestInit) =>
      new Response('{"event_id":"$e"}', { status: 200 })
  )
}

describe('GET /api/v1/health/matrix-test', () => {
  test('reports configured only when all three env vars are set', async () => {
    const configured = async () =>
      ((await (await handleGet()).json()) as { configured: boolean }).configured
    expect(await configured()).toBe(false)
    process.env.HEALTH_ALERT_MATRIX_HOMESERVER_URL = AD_HOC.homeserverUrl
    process.env.HEALTH_ALERT_MATRIX_ACCESS_TOKEN = AD_HOC.accessToken
    process.env.HEALTH_ALERT_MATRIX_ROOM_ID = AD_HOC.roomId
    expect(await configured()).toBe(true)
  })
})

describe('POST /api/v1/health/matrix-test', () => {
  test('anonymous is blocked, no egress', async () => {
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const fetchImpl = okFetch()
    const res = await handlePost(makeRequest(AD_HOC), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: resolvePublic,
    })
    expect(res.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('blocks a homeserver that resolves to a private address, no egress', async () => {
    const fetchImpl = okFetch()
    const res = await handlePost(makeRequest(AD_HOC), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: resolvePrivate,
    })
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('rejects a room alias before any lookup or egress', async () => {
    const fetchImpl = okFetch()
    const res = await handlePost(
      makeRequest({ ...AD_HOC, roomId: '#ops:example.org' }),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveHostAddresses: resolvePublic,
      }
    )
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('sends to an allowed ad-hoc room with a fresh txn id each click', async () => {
    const fetchImpl = okFetch()
    const deps = {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: resolvePublic,
    }
    expect((await handlePost(makeRequest(AD_HOC), deps)).status).toBe(200)
    expect((await handlePost(makeRequest(AD_HOC), deps)).status).toBe(200)
    const [first, second] = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(first).toContain('/rooms/%21abc%3Aexample.org/send/m.room.message/')
    expect(first).not.toBe(second)
  })

  test('rejects a homeserver with credentials, query or fragment, no egress', async () => {
    for (const homeserverUrl of [
      'https://u:p@matrix.example.org',
      'https://matrix.example.org?x=1',
      'https://matrix.example.org#f',
    ]) {
      const fetchImpl = okFetch()
      const res = await handlePost(makeRequest({ ...AD_HOC, homeserverUrl }), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveHostAddresses: resolvePublic,
      })
      expect(res.status).toBe(400)
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  test('sends to the normalized homeserver base', async () => {
    const fetchImpl = okFetch()
    await handlePost(
      makeRequest({
        ...AD_HOC,
        homeserverUrl: 'https://matrix.example.org/m//',
      }),
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveHostAddresses: resolvePublic,
      }
    )
    expect(String(fetchImpl.mock.calls[0]?.[0])).toStartWith(
      'https://matrix.example.org/m/_matrix/'
    )
  })

  test('no body and no env config is a 400', async () => {
    const fetchImpl = okFetch()
    const res = await handlePost(makeRequest(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('M_FORBIDDEN maps to a 502 that tells the operator to join the bot', async () => {
    const fetchImpl = mock(
      async () =>
        new Response('{"errcode":"M_FORBIDDEN"}', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const res = await handlePost(makeRequest(AD_HOC), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveHostAddresses: resolvePublic,
    })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).toContain('joined')
    expect(text).not.toContain(AD_HOC.accessToken)
  })
})
