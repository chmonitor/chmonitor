import { beforeEach, expect, mock, test } from 'bun:test'
import { ConversationStoreError } from '@/lib/conversation-store/types'

// #4020: an anonymous caller must be rejected by auth, never shown the
// 501 that reveals conversation storage is off, and nothing may be read.
const resolveStore = mock(async () => ({}))
const autoMigrate = mock(async () => {})
mock.module('@/lib/conversation-store/auth', () => ({
  resolveUserId: async () => {
    throw new ConversationStoreError(
      'Authentication is required for conversation storage.',
      'UNAUTHORIZED'
    )
  },
}))
mock.module('@/lib/conversation-store/resolve-store', () => ({ resolveStore }))
mock.module('@/lib/feature-flags', () => ({ isFeatureEnabled: () => false }))
mock.module('@/lib/migration/auto-migrate', () => ({ autoMigrate }))

const { Route } = await import('../$id')
type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>
const handlers = (Route.options.server as { handlers: Record<string, Handler> })
  .handlers

beforeEach(() => {
  resolveStore.mockClear()
  autoMigrate.mockClear()
})

test('GET: anonymous caller with storage off gets 404 (hidden), not 501', async () => {
  const res = await handlers.GET({
    request: new Request('http://localhost/x?name=d', { method: 'GET' }),
    params: { id: 'c1' },
  })

  expect(res.status).toBe(404)
  expect(resolveStore).not.toHaveBeenCalled()
  expect(autoMigrate).not.toHaveBeenCalled()
})

test('PUT: anonymous caller with storage off gets 404 (hidden), not 501', async () => {
  const res = await handlers.PUT({
    request: new Request('http://localhost/x?name=d', {
      method: 'PUT',
      body: '{}',
    }),
    params: { id: 'c1' },
  })

  expect(res.status).toBe(404)
  expect(resolveStore).not.toHaveBeenCalled()
  expect(autoMigrate).not.toHaveBeenCalled()
})

test('DELETE: anonymous caller with storage off gets 404 (hidden), not 501', async () => {
  const res = await handlers.DELETE({
    request: new Request('http://localhost/x?name=d', { method: 'DELETE' }),
    params: { id: 'c1' },
  })

  expect(res.status).toBe(404)
  expect(resolveStore).not.toHaveBeenCalled()
  expect(autoMigrate).not.toHaveBeenCalled()
})
