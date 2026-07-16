import type { ConnectionStore } from '@/lib/connection-store/types'

import { describe, expect, mock, test } from 'bun:test'

// Mock the Clerk backend client used in the org path.
let getOrganizationMembershipList = mock(
  async (_args: { organizationId: string; limit: number }) => ({
    data: [] as Array<{ publicUserData?: { userId?: string | null } }>,
  })
)
mock.module('@clerk/tanstack-react-start/server', () => ({
  clerkClient: () => ({
    organizations: { getOrganizationMembershipList },
  }),
}))

// Mock the live ClickHouse query used by replica-detection's probe. Tests that
// don't care about replica weighting never populate credentials, so this is
// only exercised by the weighting-specific tests below.
let queryConnectionImpl: (...args: unknown[]) => Promise<unknown> =
  async () => ({
    data: [],
  })
mock.module('@/lib/connection-query/connection-client', () => ({
  queryConnection: (...args: unknown[]) => queryConnectionImpl(...args),
}))

const { countOwnerHosts } = await import('./org-host-count')

// A fake store whose list() returns N placeholder rows per user, from a map.
// No `id`/credentials — weighting falls back to a full host per connection.
function fakeStore(counts: Record<string, number>): ConnectionStore {
  return {
    list: async (userId: string) =>
      Array.from({ length: counts[userId] ?? 0 }, () => ({}) as never),
  } as unknown as ConnectionStore
}

// A fake store that additionally serves credentials, so replica weighting via
// probeHostTopology (mocked above) actually runs.
function fakeStoreWithCredentials(
  connectionsByUser: Record<string, string[]>
): ConnectionStore {
  return {
    list: async (userId: string) =>
      (connectionsByUser[userId] ?? []).map((id) => ({ id }) as never),
    getCredentials: async (_userId: string, id: string) => ({
      host: `https://${id}.example.com`,
      user: 'x',
      password: 'y',
    }),
  } as unknown as ConnectionStore
}

describe('countOwnerHosts', () => {
  test('user owner counts only the acting user', async () => {
    const store = fakeStore({ user_a: 2, user_b: 5 })
    const usage = await countOwnerHosts(
      { type: 'user', id: 'user_a' },
      store,
      'user_a'
    )
    expect(usage.count).toBe(2)
    expect(usage.memberUserIds).toEqual(['user_a'])
  })

  test('org owner pools connections across all current members', async () => {
    getOrganizationMembershipList = mock(async () => ({
      data: [
        { publicUserData: { userId: 'user_a' } },
        { publicUserData: { userId: 'user_b' } },
      ],
    }))
    const store = fakeStore({ user_a: 2, user_b: 3, user_c: 9 })
    // owner is the org; acting user is a member. Pool = a(2) + b(3) = 5.
    const usage = await countOwnerHosts(
      { type: 'org', id: 'org_1' },
      store,
      'user_a'
    )
    expect(usage.count).toBe(5)
    expect(usage.memberUserIds).toEqual(['user_a', 'user_b'])
  })

  test('acting user is counted even if not yet in the membership list', async () => {
    getOrganizationMembershipList = mock(async () => ({
      data: [{ publicUserData: { userId: 'user_b' } }],
    }))
    const store = fakeStore({ user_a: 4, user_b: 1 })
    const usage = await countOwnerHosts(
      { type: 'org', id: 'org_1' },
      store,
      'user_a'
    )
    expect(usage.count).toBe(5) // b(1) + a(4), a appended
    expect(usage.memberUserIds).toEqual(['user_b', 'user_a'])
  })

  test('org enumeration failure falls back to the acting user count', async () => {
    getOrganizationMembershipList = mock(async () => {
      throw new Error('clerk down')
    })
    const store = fakeStore({ user_a: 3 })
    const usage = await countOwnerHosts(
      { type: 'org', id: 'org_1' },
      store,
      'user_a'
    )
    expect(usage.count).toBe(3)
    expect(usage.memberUserIds).toEqual(['user_a'])
  })

  test('a detected replica in the same cluster shard bills at 0.5 host', async () => {
    const topologyByHost: Record<
      string,
      { cluster: string; shard_num: number }
    > = {
      conn_primary: { cluster: 'prod', shard_num: 1 },
      conn_replica: { cluster: 'prod', shard_num: 1 },
    }
    // queryConnection(credentials, sql) — id is embedded in the host, extract it.
    queryConnectionImpl = async (...args: unknown[]) => {
      const credentials = args[0] as { host: string }
      const id = credentials.host.replace('https://', '').split('.')[0]
      const row = topologyByHost[id]
      return { data: row ? [row] : [] }
    }

    const store = fakeStoreWithCredentials({
      user_a: ['conn_primary', 'conn_replica'],
    })
    const usage = await countOwnerHosts(
      { type: 'user', id: 'user_a' },
      store,
      'user_a'
    )
    expect(usage.count).toBe(1.5)
  })

  test('standalone hosts (no cluster) each bill as a full host', async () => {
    queryConnectionImpl = async () => ({ data: [] })
    const store = fakeStoreWithCredentials({
      user_a: ['conn_1', 'conn_2'],
    })
    const usage = await countOwnerHosts(
      { type: 'user', id: 'user_a' },
      store,
      'user_a'
    )
    expect(usage.count).toBe(2)
  })
})
