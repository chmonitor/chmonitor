/**
 * Route tests for /api/v1/health/routes CRUD, masking, and write-auth gate.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let ownerId = ''
let requiresSignIn = false

mock.module('@/lib/health/alert-routing-auth', () => ({
  SINGLE_TENANT_OWNER_ID: '',
  resolveAlertRoutingOwnerId: async () => ownerId,
  requiresSignInForWrite: (resolvedOwnerId: string) =>
    requiresSignIn && resolvedOwnerId === '',
}))

const FULL_ROUTING_KEY = '0123456789abcdef0123456789abcdef'
const FULL_TELEGRAM_TOKEN = '1234567890:ABCDEFghijklmnopqrstuvwxyz123456'

let listedRoutes: unknown[] = []
let createdRoute: Record<string, unknown> | null = null
let deleteResult = true

mock.module('@/lib/health/alert-routing', () => ({
  listRoutes: async () => listedRoutes,
  createRoute: async (input: Record<string, unknown>) => {
    createdRoute = {
      id: 'route-1',
      matchRule: input.matchRule,
      matchHost: input.matchHost,
      channelUrl: input.channelUrl,
      enabled: input.enabled,
      createdAt: 1,
      provider: input.provider,
      serviceName: input.serviceName ?? null,
      routingKey: input.routingKey,
      telegramChatId: input.telegramChatId,
      telegramBotToken: input.telegramBotToken,
      ntfyUrl: input.ntfyUrl ?? null,
      ntfyToken: input.ntfyToken ?? null,
      pushoverUser: input.pushoverUser ?? null,
      pushoverToken: input.pushoverToken ?? null,
      minSeverity: input.minSeverity ?? null,
    }
    return createdRoute
  },
  deleteRoute: async (_ownerId: string, id: string) =>
    deleteResult && id === 'owned-route',
}))

mock.module('@/lib/browser-connections/host-url', () => ({
  validateHostUrl: async () => null,
}))

mock.module('@/lib/health/pagerduty-config', () => ({
  PAGERDUTY_EVENTS_API_URL: 'https://events.pagerduty.com/v2/enqueue',
}))

const {
  __handleDeleteForTests: handleDelete,
  __handleGetForTests: handleGet,
  __handlePostForTests: handlePost,
} = await import('../routes')

beforeEach(() => {
  ownerId = ''
  requiresSignIn = false
  listedRoutes = []
  createdRoute = null
  deleteResult = true
})

function jsonContainsFullSecret(body: unknown, secret: string): boolean {
  return JSON.stringify(body).includes(secret)
}

describe('GET /api/v1/health/routes', () => {
  test('returns 200 with empty list when store has no routes', async () => {
    const res = await handleGet()
    expect(res.status).toBe(200)
    expect((await res.json()) as { routes: unknown[] }).toEqual({
      success: true,
      routes: [],
    })
  })

  test('masks pagerduty and telegram secrets in listed routes', async () => {
    listedRoutes = [
      {
        id: 'r1',
        matchRule: '*',
        matchHost: '*',
        channelUrl: 'https://events.pagerduty.com/v2/enqueue',
        enabled: true,
        createdAt: 1,
        provider: 'pagerduty',
        serviceName: 'prod',
        routingKey: FULL_ROUTING_KEY,
        telegramChatId: '-100123',
        telegramBotToken: FULL_TELEGRAM_TOKEN,
        ntfyUrl: null,
        ntfyToken: null,
        pushoverUser: null,
        pushoverToken: null,
        minSeverity: null,
      },
    ]

    const res = await handleGet()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(jsonContainsFullSecret(body, FULL_ROUTING_KEY)).toBe(false)
    expect(jsonContainsFullSecret(body, FULL_TELEGRAM_TOKEN)).toBe(false)
    expect(JSON.stringify(body)).toContain('••••')
  })
})

describe('POST /api/v1/health/routes', () => {
  test('401 when cloud write gate requires sign-in', async () => {
    requiresSignIn = true
    const res = await handlePost(
      new Request('https://dash.example.com/api/v1/health/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'pagerduty',
          routingKey: FULL_ROUTING_KEY,
          serviceName: 'prod',
        }),
      })
    )
    expect(res.status).toBe(401)
  })

  test('201 for OSS anonymous create scoped to resolved owner', async () => {
    ownerId = ''
    const res = await handlePost(
      new Request('https://dash.example.com/api/v1/health/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'telegram',
          telegramBotToken: FULL_TELEGRAM_TOKEN,
          telegramChatId: '-100123',
        }),
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(jsonContainsFullSecret(body, FULL_TELEGRAM_TOKEN)).toBe(false)
  })
})

describe('DELETE /api/v1/health/routes', () => {
  test('404 when route id is not found for owner', async () => {
    deleteResult = false
    const res = await handleDelete(
      new Request('https://dash.example.com/api/v1/health/routes?id=missing', {
        method: 'DELETE',
      })
    )
    expect(res.status).toBe(404)
  })

  test('200 when owned route deletes successfully', async () => {
    const res = await handleDelete(
      new Request(
        'https://dash.example.com/api/v1/health/routes?id=owned-route',
        {
          method: 'DELETE',
        }
      )
    )
    expect(res.status).toBe(200)
  })
})
