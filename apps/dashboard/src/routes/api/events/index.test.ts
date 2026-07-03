/**
 * Unit tests for GET /api/events — the read-gate wiring and the empty-list
 * degrade when CHM_CLOUD_D1 is unbound (self-host / local dev). listEvents'
 * own filtering/retention-window behavior is covered by
 * lib/events/event-store.test.ts; this file only covers route wiring.
 *
 * `@/lib/feature-permissions/server` is mocked (mirrors
 * routes/api/v1/health/webhook.test.ts): the real module imports
 * `cloudflare:workers`, which is unavailable outside a Worker, so importing it
 * here would crash. `@chm/platform` is mocked so `listEvents` degrades to []
 * without a Workers runtime.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let authorizeFeatureRequest = mock(
  async (_permission: unknown, _request: Request): Promise<Response | null> =>
    null
)
mock.module('@/lib/feature-permissions/server', () => ({
  getAppConfig: () => ({ authProvider: 'none' as const, features: {} }),
  _resetAppConfigCache: () => {},
  publicReadEnabled: () => true,
  authorizeFeatureRequest: (permission: unknown, request: Request) =>
    authorizeFeatureRequest(permission, request),
}))

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => null,
    getQueue: () => null,
    getDurableObjectNamespace: () => null,
  }),
}))

const { __handleGetForTests: handleGet } = await import('./index')

function makeRequest(query = ''): Request {
  return new Request(`https://dash.example.com/api/events${query}`)
}

beforeEach(() => {
  authorizeFeatureRequest = mock(async () => null)
})

describe('GET /api/events', () => {
  test('returns an empty list when CHM_CLOUD_D1 is unbound', async () => {
    const res = await handleGet(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: unknown[] }
    expect(body).toEqual({ success: true, data: [] })
  })

  test('honors the read-access gate', async () => {
    authorizeFeatureRequest = mock(async () =>
      Response.json({ error: 'nope' }, { status: 401 })
    )
    const res = await handleGet(makeRequest())
    expect(res.status).toBe(401)
  })

  test('accepts source/severity/sinceMs/limit query params without throwing', async () => {
    const res = await handleGet(
      makeRequest('?source=datadog&severity=critical&sinceMs=0&limit=10')
    )
    expect(res.status).toBe(200)
  })

  test('ignores non-numeric sinceMs/limit rather than 500ing', async () => {
    const res = await handleGet(makeRequest('?sinceMs=notanumber&limit=abc'))
    expect(res.status).toBe(200)
  })
})
