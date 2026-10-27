/**
 * A malformed JSON body is the caller's mistake, so it must be a 400
 * ValidationError, not a 500 that looks like a server fault (the equivalent of
 * `curl -X POST -d '{' ...`).
 */
import { describe, expect, mock, test } from 'bun:test'

const envVars: Record<string, string | undefined> = {
  CLICKHOUSE_HOST: 'http://localhost:8123',
  CLICKHOUSE_USER: 'default',
  CLICKHOUSE_PASSWORD: '',
}
mock.module('cloudflare:workers', () => ({ env: envVars }))
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: null }),
}))

// Conversation routes: get past migration, feature flag and user resolution
// so the body parse is what is under test.
mock.module('@/lib/migration/auto-migrate', () => ({
  autoMigrate: async () => {},
}))

import * as realFlags from '@/lib/feature-flags'

mock.module('@/lib/feature-flags', () => ({
  ...realFlags,
  isFeatureEnabled: () => true,
}))

mock.module('@/lib/conversation-store/server-feature', () => ({
  isConversationDbEnabled: () => true,
}))

import * as realAuth from '@/lib/conversation-store/auth'

mock.module('@/lib/conversation-store/auth', () => ({
  ...realAuth,
  resolveUserId: async () => 'user_123',
  resolveConversationUserId: async () => 'user_123',
}))

const { handlePost: dataPost } = await import('@/routes/api/v1/data')
const { Route: settingsRoute } = await import(
  '@/routes/api/v1/dashboard/settings'
)
const { Route: conversationsRoute } = await import(
  '@/routes/api/v1/conversations'
)
const { Route: conversationRoute } = await import(
  '@/routes/api/v1/conversations/$id'
)

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>

function handlerOf(route: unknown, method: string): Handler {
  const handlers = (
    route as { options: { server: { handlers: Record<string, Handler> } } }
  ).options.server.handlers
  return handlers[method]
}

function badJson(path: string, method = 'POST') {
  return new Request(`http://x${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  })
}

async function expectInvalidJson(res: Response) {
  expect(res.status).toBe(400)
  const body = (await res.json()) as {
    error?: { type?: string; message?: string }
  }
  expect(body.error?.type).toBe('validation_error')
  expect(body.error?.message).toBe('Invalid JSON body')
}

describe("malformed JSON body ('{') -> 400", () => {
  test('POST /api/v1/data', async () => {
    await expectInvalidJson(await dataPost(badJson('/api/v1/data')))
  })

  test('POST /api/v1/dashboard/settings', async () => {
    const res = await handlerOf(
      settingsRoute,
      'POST'
    )({
      request: badJson('/api/v1/dashboard/settings'),
      params: {},
    })
    await expectInvalidJson(res)
  })

  test('POST /api/v1/conversations', async () => {
    const res = await handlerOf(
      conversationsRoute,
      'POST'
    )({
      request: badJson('/api/v1/conversations'),
      params: {},
    })
    await expectInvalidJson(res)
  })

  test('PUT /api/v1/conversations/$id', async () => {
    const res = await handlerOf(
      conversationRoute,
      'PUT'
    )({
      request: badJson('/api/v1/conversations/abc', 'PUT'),
      params: { id: 'abc' },
    })
    await expectInvalidJson(res)
  })
})
