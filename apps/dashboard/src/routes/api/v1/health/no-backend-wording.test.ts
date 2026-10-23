/**
 * The 501 a write returns when the deployment has no metadata database (#4053).
 *
 * The real stores run with no D1 binding and no DATABASE_URL, so each message
 * comes from the shared helper, not from a string the route owns. A self-hosted
 * operator is told about DATABASE_URL first and never about wrangler. Status
 * codes stay 501.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { installHealthPlatformMock } from '@/lib/health/__tests__/platform-mock'

const realFeaturePermissions = {
  ...(await import('@/lib/feature-permissions/server')),
}
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))
const realAlertRoutingAuth = {
  ...(await import('@/lib/health/alert-routing-auth')),
}
mock.module('@/lib/health/alert-routing-auth', () => ({
  SINGLE_TENANT_OWNER_ID: '',
  resolveConfigOwner: async () => '',
  requiresSignInForWrite: () => false,
}))
const realHostUrl = { ...(await import('@/lib/browser-connections/host-url')) }
mock.module('@/lib/browser-connections/host-url', () => ({
  validateHostUrl: async () => null,
}))
installHealthPlatformMock(() => undefined)

const { noBackendOrWriteFailedMessage } = await import(
  '@/lib/health/no-backend-message'
)
const { __handlePostForTests: postRoute } = await import('./routes')
const { __handlePutForTests: putAlertConfig } = await import('./alert-config')
const { __handlePutForTests: putWebhookTarget } = await import(
  './webhook-targets'
)
const { __handlePutForTests: putDigest } = await import('./alert-digest')

const PG_ENV = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'] as const
const SAVED = Object.fromEntries(PG_ENV.map((k) => [k, process.env[k]]))

beforeEach(() => {
  for (const k of PG_ENV) delete process.env[k]
})
afterEach(() => {
  for (const k of PG_ENV) {
    const v = SAVED[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function json(method: string, body: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function messageOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { message?: string } }
  return body.error?.message ?? ''
}

/** DATABASE_URL first, D1 only as the Workers alternative, no wrangler. */
function expectSharedWording(message: string, feature: string) {
  expect(message).toBe(noBackendOrWriteFailedMessage(feature))
  expect(message.indexOf('DATABASE_URL')).toBeGreaterThan(-1)
  expect(message.indexOf('DATABASE_URL')).toBeLessThan(message.indexOf('D1'))
  expect(message).not.toContain('wrangler')
}

describe('no backend: write routes answer 501 with the shared wording', () => {
  test('routes (create)', async () => {
    const res = await postRoute(
      json('POST', {
        provider: 'webhook',
        channelUrl: 'https://hooks.example.com/abc',
      })
    )
    expect(res.status).toBe(501)
    expectSharedWording(await messageOf(res), 'Alert routing storage')
  })

  test('alert-config (upsert)', async () => {
    const res = await putAlertConfig(
      json('PUT', {
        channel: 'telegram',
        enabled: true,
        target: { chatId: '-1' },
      })
    )
    expect(res.status).toBe(501)
    expectSharedWording(await messageOf(res), 'Alert channel storage')
  })

  test('webhook-targets (upsert)', async () => {
    const res = await putWebhookTarget(
      json('PUT', { name: 'ops', url: 'https://hooks.example.com/abc' })
    )
    expect(res.status).toBe(501)
    expectSharedWording(await messageOf(res), 'Custom webhook storage')
  })

  test('alert-digest (save)', async () => {
    const res = await putDigest(
      json('PUT', { enabled: true, windowMinutes: 30 })
    )
    expect(res.status).toBe(501)
    expectSharedWording(await messageOf(res), 'Digest settings storage')
  })
})

describe('shared helper', () => {
  test('still says the write may have failed on a configured backend', () => {
    expect(noBackendOrWriteFailedMessage('X')).toContain('write itself failed')
  })
})

// Restore the real modules so these mocks never leak into other test files.
afterAll(() => {
  mock.module('@/lib/feature-permissions/server', () => ({
    ...realFeaturePermissions,
  }))
  mock.module('@/lib/health/alert-routing-auth', () => ({
    ...realAlertRoutingAuth,
  }))
  mock.module('@/lib/browser-connections/host-url', () => ({ ...realHostUrl }))
})
