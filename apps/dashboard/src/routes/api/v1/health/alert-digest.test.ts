/**
 * Auth / validation tests for the time-window digest settings API (#2663). The
 * store + owner resolution are mocked so this stays hermetic (no D1, no Clerk)
 * and focuses on the route's own contract:
 *   - GET reflects a saved row, or the env fallback when there is none
 *   - writes require the `settings` feature auth gate
 *   - cloud-anon writes are rejected by `requiresSignInForWrite`
 *   - a negative / non-numeric window is a 400; a no-D1 save is a 501
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let authorizeFeatureRequest = mock(
  async (
    _permission: unknown,
    _request: Request,
    _options?: { allowAgentBearerToken?: boolean }
  ): Promise<Response | null> => null
)
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: (
    permission: unknown,
    request: Request,
    options?: { allowAgentBearerToken?: boolean }
  ) => authorizeFeatureRequest(permission, request, options),
}))

let requiresSignIn = false
mock.module('@/lib/health/alert-routing-auth', () => ({
  resolveAlertRoutingOwnerId: async () => '',
  requiresSignInForWrite: () => requiresSignIn,
}))

let getResult: { enabled: boolean; windowMinutes: number } | null = null
let setResult: { enabled: boolean; windowMinutes: number } | null = null
const setCalls: unknown[] = []
mock.module('@/lib/health/alert-digest-settings-store', () => ({
  getDigestSettings: async () => getResult,
  setDigestSettings: async (_ownerId: string, input: unknown) => {
    setCalls.push(input)
    return setResult
  },
}))

let envWindow = 0
mock.module('@/lib/health/server-alert-config', () => ({
  getServerDigestWindowMinutes: () => envWindow,
}))

const { __handleGetForTests: handleGet, __handlePutForTests: handlePut } =
  await import('./alert-digest')

function putRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/health/alert-digest', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
  requiresSignIn = false
  getResult = null
  setResult = null
  setCalls.length = 0
  envWindow = 0
})

describe('GET /api/v1/health/alert-digest', () => {
  test('reflects a saved row over the env value', async () => {
    getResult = { enabled: true, windowMinutes: 45 }
    envWindow = 10
    const res = await handleGet()
    const json = (await res.json()) as Record<string, unknown>
    expect(json).toMatchObject({
      success: true,
      enabled: true,
      windowMinutes: 45,
      hasRow: true,
      envWindowMinutes: 10,
    })
  })

  test('falls back to the env value when no row exists', async () => {
    getResult = null
    envWindow = 20
    const res = await handleGet()
    const json = (await res.json()) as Record<string, unknown>
    expect(json).toMatchObject({
      enabled: true,
      windowMinutes: 20,
      hasRow: false,
    })
  })
})

describe('PUT /api/v1/health/alert-digest', () => {
  test('saves enabled + window minutes', async () => {
    setResult = { enabled: true, windowMinutes: 30 }
    const res = await handlePut(
      putRequest({ enabled: true, windowMinutes: 30 })
    )
    expect(res.status).toBe(200)
    expect(setCalls[0]).toEqual({ enabled: true, windowMinutes: 30 })
  })

  test('a blocked auth gate short-circuits the write', async () => {
    authorizeFeatureRequest = mock(
      async () => new Response('nope', { status: 403 })
    )
    const res = await handlePut(
      putRequest({ enabled: true, windowMinutes: 30 })
    )
    expect(res.status).toBe(403)
    expect(setCalls).toHaveLength(0)
  })

  test('cloud-anon write is rejected (401)', async () => {
    requiresSignIn = true
    const res = await handlePut(
      putRequest({ enabled: true, windowMinutes: 30 })
    )
    expect(res.status).toBe(401)
  })

  test('a negative window is a 400', async () => {
    const res = await handlePut(
      putRequest({ enabled: true, windowMinutes: -5 })
    )
    expect(res.status).toBe(400)
    expect(setCalls).toHaveLength(0)
  })

  test('no D1 binding (store returns null) is a 501', async () => {
    setResult = null
    const res = await handlePut(
      putRequest({ enabled: true, windowMinutes: 30 })
    )
    expect(res.status).toBe(501)
  })
})
