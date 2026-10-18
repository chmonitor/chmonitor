import { beforeEach, expect, mock, test } from 'bun:test'
import { DashboardStoreError } from '@/lib/dashboard-storage/types'

// #4020: an anonymous caller must be rejected by auth, never shown the
// 501 that reveals dashboard storage is off, and nothing may be read.
const resolveDashboardStore = mock(async () => ({}))
const autoMigrate = mock(async () => {})
mock.module('@/lib/dashboard-storage/auth', () => ({
  resolveDashboardOwnerId: async () => {
    throw new DashboardStoreError(
      'Authentication is required for dashboard storage.',
      'UNAUTHORIZED'
    )
  },
}))
mock.module('@/lib/dashboard-storage/resolve-server-store', () => ({
  resolveDashboardStore,
}))
mock.module('@/lib/feature-flags', () => ({ isFeatureEnabled: () => false }))
mock.module('@/lib/migration/auto-migrate', () => ({ autoMigrate }))

const { Route } = await import('../list')
type Handler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>
const handlers = (Route.options.server as { handlers: Record<string, Handler> })
  .handlers

beforeEach(() => {
  resolveDashboardStore.mockClear()
  autoMigrate.mockClear()
})

test('GET: anonymous caller with storage off gets 403, not 501', async () => {
  const res = await handlers.GET({
    request: new Request('http://localhost/x?name=d', { method: 'GET' }),
    params: { id: 'c1' },
  })

  expect(res.status).toBe(403)
  expect(resolveDashboardStore).not.toHaveBeenCalled()
  expect(autoMigrate).not.toHaveBeenCalled()
})
