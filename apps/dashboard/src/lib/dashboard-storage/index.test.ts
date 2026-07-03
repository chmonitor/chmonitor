/**
 * Tests for the public `dashboard-storage` entrypoint's backend resolution:
 *   - `featureFlags.conversationDb()` false (or throwing) → localStorage,
 *     never calls the remote (D1-backed) API — the "D1-absent falls back to
 *     localStorage" requirement.
 *   - `featureFlags.conversationDb()` true → remote (D1-backed) API.
 *   - Sharing is unavailable (throws) on the local-only backend, since a
 *     single browser's localStorage has no server to serve a public link.
 *
 * Mirrors `conversation-store/resolve-store.test.ts`'s mock.module pattern:
 * `./local-store` and `./remote-store` are mocked wholesale so this file
 * tests only the resolution branch, not localStorage/fetch behavior (those
 * are covered by `local-store.test.ts` and exercised end-to-end by the
 * routes).
 */

import { describe, expect, mock, test } from 'bun:test'

const mockConversationDb = mock(() => true)
mock.module('@/lib/feature-flags', () => ({
  featureFlags: {
    conversationDb: mockConversationDb,
  },
}))

const localCalls = {
  list: mock(() => ['local-a', 'local-b']),
  load: mock((_name: string) => ['chart-local']),
  save: mock((_name: string, _charts: string[]) => {}),
  del: mock((_name: string) => {}),
}
mock.module('./local-store', () => ({
  listDashboardsLocal: localCalls.list,
  loadDashboardLocal: localCalls.load,
  saveDashboardLocal: localCalls.save,
  deleteDashboardLocal: localCalls.del,
}))

const remoteCalls = {
  list: mock(async () => ['remote-a']),
  load: mock(async (_name: string) => ['chart-remote']),
  save: mock(async (_name: string, _charts: string[]) => {}),
  del: mock(async (_name: string) => {}),
  share: mock(async (_name: string) => 'slug-123'),
  unshare: mock(async (_name: string) => {}),
}
mock.module('./remote-store', () => ({
  listDashboardsRemote: remoteCalls.list,
  loadDashboardRemote: remoteCalls.load,
  saveDashboardRemote: remoteCalls.save,
  deleteDashboardRemote: remoteCalls.del,
  shareDashboardRemote: remoteCalls.share,
  unshareDashboardRemote: remoteCalls.unshare,
}))

const {
  resolveDashboardBackend,
  listDashboards,
  loadDashboard,
  saveDashboard,
  deleteDashboard,
  shareDashboard,
  unshareDashboard,
} = await import('./index')

function resetMocks() {
  mockConversationDb.mockReset()
  mockConversationDb.mockReturnValue(true)
  for (const fn of Object.values(localCalls)) fn.mockClear()
  for (const fn of Object.values(remoteCalls)) fn.mockClear()
}

describe('resolveDashboardBackend', () => {
  test('returns "d1" when conversationDb() is true', () => {
    resetMocks()
    expect(resolveDashboardBackend()).toBe('d1')
  })

  test('returns "local" when conversationDb() is false', () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    expect(resolveDashboardBackend()).toBe('local')
  })

  test('returns "local" when conversationDb() throws (fail-open)', () => {
    resetMocks()
    mockConversationDb.mockImplementation(() => {
      throw new Error('Clerk enablement check failed')
    })
    expect(resolveDashboardBackend()).toBe('local')
  })
})

describe('D1-absent falls back to localStorage', () => {
  test('listDashboards() uses the local store and never calls remote', async () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    const result = await listDashboards()
    expect(result).toEqual(['local-a', 'local-b'])
    expect(localCalls.list).toHaveBeenCalledTimes(1)
    expect(remoteCalls.list).not.toHaveBeenCalled()
  })

  test('loadDashboard() uses the local store and never calls remote', async () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    const result = await loadDashboard('myDash')
    expect(result).toEqual(['chart-local'])
    expect(localCalls.load).toHaveBeenCalledWith('myDash')
    expect(remoteCalls.load).not.toHaveBeenCalled()
  })

  test('saveDashboard() uses the local store and never calls remote', async () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    await saveDashboard('myDash', ['c1'])
    expect(localCalls.save).toHaveBeenCalledWith('myDash', ['c1'])
    expect(remoteCalls.save).not.toHaveBeenCalled()
  })

  test('deleteDashboard() uses the local store and never calls remote', async () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    await deleteDashboard('myDash')
    expect(localCalls.del).toHaveBeenCalledWith('myDash')
    expect(remoteCalls.del).not.toHaveBeenCalled()
  })
})

describe('D1-enabled uses the remote store', () => {
  test('listDashboards() calls remote, not local', async () => {
    resetMocks()
    const result = await listDashboards()
    expect(result).toEqual(['remote-a'])
    expect(remoteCalls.list).toHaveBeenCalledTimes(1)
    expect(localCalls.list).not.toHaveBeenCalled()
  })

  test('saveDashboard() calls remote, not local', async () => {
    resetMocks()
    await saveDashboard('myDash', ['c1'])
    expect(remoteCalls.save).toHaveBeenCalledWith('myDash', ['c1'])
    expect(localCalls.save).not.toHaveBeenCalled()
  })
})

describe('sharing requires the D1 backend', () => {
  test('shareDashboard() resolves via remote when D1-enabled', async () => {
    resetMocks()
    const slug = await shareDashboard('myDash')
    expect(slug).toBe('slug-123')
    expect(remoteCalls.share).toHaveBeenCalledWith('myDash')
  })

  test('shareDashboard() throws (does not silently no-op) on the local backend', async () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    await expect(shareDashboard('myDash')).rejects.toThrow()
    expect(remoteCalls.share).not.toHaveBeenCalled()
  })

  test('unshareDashboard() throws on the local backend', async () => {
    resetMocks()
    mockConversationDb.mockReturnValue(false)
    await expect(unshareDashboard('myDash')).rejects.toThrow()
    expect(remoteCalls.unshare).not.toHaveBeenCalled()
  })
})
