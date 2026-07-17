/**
 * Tests for D1ConnectionStore.create()'s atomic host-limit enforcement — the
 * fix for the count-then-insert TOCTOU race (epic #2097 BE-6).
 *
 * Uses a small behavioral fake of D1Database (prepare/bind/run) injected
 * through a mocked @chm/platform, so we exercise the REAL SQL the store
 * issues rather than re-implementing the guard in JS: the fake parses out
 * whether a statement is the guarded `INSERT ... SELECT ... WHERE (SELECT
 * COUNT(*) ...) < ?` form or the plain unconditional INSERT, and reports
 * `meta.changes` the way SQLite/D1 actually would (0 rows changed when the
 * WHERE's SELECT produces no row).
 *
 * What this validates:
 *  - a single INSERT...SELECT...WHERE statement inserts when under the cap
 *    and no-ops (throws LIMIT_EXCEEDED) when at/over the cap — in ONE D1
 *    round trip, not a separate count then insert.
 *  - the count is scoped to the given memberUserIds (pooled org semantics),
 *    not just the acting user's own rows.
 *  - concurrent creates that race past a stale pre-check cannot both land:
 *    only one atomic statement observes room under the cap.
 *  - limit: null (unlimited plan) skips the guard and always inserts.
 *
 * What this does NOT validate: real SQLite/D1 transaction semantics under
 * true network concurrency — there is no D1 emulator in this test suite.
 * The fake's `run()` calls are synchronous-per-row-set, which mirrors D1's
 * documented guarantee that a single prepared statement executes atomically,
 * but a real Workers-runtime integration test would be needed to verify that
 * guarantee end-to-end.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface FakeRow {
  id: string
  user_id: string
  name: string
  host_url: string
  ch_user: string
  host_id: number
  engine: string
  encrypted_payload: string
  created_at: number
  updated_at: number
}

function makeFakeD1() {
  const rows: FakeRow[] = []

  // Mirrors the host_id-allocation subquery the store embeds in its INSERT
  // (issue #2676): min(existing DB-range id for this user) - 1, or the range
  // start when the user has none. Evaluated at run() time — i.e. against the
  // row set as it stands when the single statement executes — which is
  // exactly D1's per-statement atomicity guarantee.
  function allocateHostId(userId: string, start: number): number {
    const ids = rows
      .filter((r) => r.user_id === userId && r.host_id <= start)
      .map((r) => r.host_id)
    return ids.length === 0 ? start : Math.min(...ids) - 1
  }

  // Column order mirrors the store's INSERT binds (host_id is allocated by
  // the statement itself, not bound): id, user_id, name, host_url, ch_user,
  // engine, encrypted_payload, created_at, updated_at, host-id range start
  // (10 values).
  function bindsToRow(b: unknown[]): FakeRow {
    return {
      id: b[0] as string,
      user_id: b[1] as string,
      name: b[2] as string,
      host_url: b[3] as string,
      ch_user: b[4] as string,
      host_id: allocateHostId(b[1] as string, b[9] as number),
      engine: b[5] as string,
      encrypted_payload: b[6] as string,
      created_at: b[7] as number,
      updated_at: b[8] as number,
    }
  }

  function prepare(sql: string) {
    return {
      bind(...binds: unknown[]) {
        return {
          async all() {
            // Only `list()` uses `.all()` in this store.
            const userId = binds[0] as string
            return { results: rows.filter((r) => r.user_id === userId) }
          },
          async first() {
            // The store's post-insert read-back of the allocated host_id.
            const id = binds[0] as string
            const row = rows.find((r) => r.id === id)
            return row ? { host_id: row.host_id } : null
          },
          async run() {
            const isGuardedInsert =
              /INSERT INTO user_connections[\s\S]*SELECT[\s\S]*WHERE[\s\S]*COUNT\(\*\)/.test(
                sql
              )

            if (!isGuardedInsert) {
              // Uncapped INSERT...SELECT (unlimited plan / no limit passed).
              rows.push(bindsToRow(binds.slice(0, 10)))
              return { success: true, meta: { changes: 1 } }
            }

            // Guarded INSERT...SELECT...WHERE (SELECT COUNT(*) ... IN (...)) < ?
            // binds = [10 insert values, ...memberUserIds, limit]
            const insertValues = binds.slice(0, 10)
            const memberUserIds = binds.slice(10, binds.length - 1) as string[]
            const limit = binds[binds.length - 1] as number

            const count = rows.filter((r) =>
              memberUserIds.includes(r.user_id)
            ).length

            if (count < limit) {
              rows.push(bindsToRow(insertValues))
              return { success: true, meta: { changes: 1 } }
            }
            return { success: true, meta: { changes: 0 } }
          },
        }
      },
    }
  }

  return { prepare, _rows: rows }
}

let currentDb: ReturnType<typeof makeFakeD1> | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { D1ConnectionStore } = await import('../d1-store')
const { ConnectionStoreError } = await import('../types')

const originalKey = process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY

const creds = (host: string) => ({ host, user: 'default', password: 'p' })
const input = (name: string, host = 'https://a.example.com') => ({
  name,
  hostUrl: host,
  chUser: 'default',
  credentials: creds(host),
})

beforeEach(() => {
  currentDb = makeFakeD1()
  process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY =
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
})

describe('D1ConnectionStore.create() atomic host limit', () => {
  test('inserts when the pooled member count is under the limit', async () => {
    const store = new D1ConnectionStore()
    const created = await store.create('user_a', input('A'), {
      memberUserIds: ['user_a'],
      limit: 3,
    })
    expect(created.name).toBe('A')
    expect(currentDb?._rows).toHaveLength(1)
  })

  test('throws LIMIT_EXCEEDED and does not insert when at the cap', async () => {
    const store = new D1ConnectionStore()
    await store.create('user_a', input('A1'), {
      memberUserIds: ['user_a'],
      limit: 1,
    })
    expect(currentDb?._rows).toHaveLength(1)

    await expect(
      store.create('user_a', input('A2'), {
        memberUserIds: ['user_a'],
        limit: 1,
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    // The rejected insert must not have landed a second row.
    expect(currentDb?._rows).toHaveLength(1)
  })

  test('pools the count across memberUserIds (org semantics)', async () => {
    const store = new D1ConnectionStore()
    await store.create('user_a', input('A1'), {
      memberUserIds: ['user_a', 'user_b'],
      limit: 2,
    })
    await store.create('user_b', input('B1'), {
      memberUserIds: ['user_a', 'user_b'],
      limit: 2,
    })
    expect(currentDb?._rows).toHaveLength(2)

    // Pool is now at the cap (2); a third create from EITHER member must fail,
    // even though user_c individually has zero connections of their own.
    await expect(
      store.create('user_a', input('A2'), {
        memberUserIds: ['user_a', 'user_b'],
        limit: 2,
      })
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    // A user OUTSIDE the pool is unaffected.
    const outside = await store.create('user_c', input('C1'), {
      memberUserIds: ['user_c'],
      limit: 2,
    })
    expect(outside.name).toBe('C1')
  })

  test('concurrent creates racing past a stale pre-check: only one lands', async () => {
    const store = new D1ConnectionStore()
    const limitArg = { memberUserIds: ['user_a'], limit: 1 }

    // Two "requests" both believe (from an earlier, now-stale pre-check) that
    // the pool has room. Only the atomic INSERT...SELECT...WHERE decides.
    const results = await Promise.allSettled([
      store.create('user_a', input('Race1'), limitArg),
      store.create('user_a', input('Race2'), limitArg),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    expect(currentDb?._rows).toHaveLength(1)
  })

  test('limit: null (unlimited plan) always inserts unconditionally', async () => {
    const store = new D1ConnectionStore()
    for (let i = 0; i < 5; i++) {
      await store.create('user_a', input(`H${i}`), {
        memberUserIds: ['user_a'],
        limit: null,
      })
    }
    expect(currentDb?._rows).toHaveLength(5)
  })

  test('omitting the limit argument entirely inserts unconditionally', async () => {
    const store = new D1ConnectionStore()
    const created = await store.create('user_a', input('NoLimitArg'))
    expect(created.name).toBe('NoLimitArg')
    expect(currentDb?._rows).toHaveLength(1)
  })

  test('LIMIT_EXCEEDED is a ConnectionStoreError instance', async () => {
    const store = new D1ConnectionStore()
    await store.create('user_a', input('A1'), {
      memberUserIds: ['user_a'],
      limit: 1,
    })
    try {
      await store.create('user_a', input('A2'), {
        memberUserIds: ['user_a'],
        limit: 1,
      })
      throw new Error('expected LIMIT_EXCEEDED to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionStoreError)
      expect((err as InstanceType<typeof ConnectionStoreError>).code).toBe(
        'LIMIT_EXCEEDED'
      )
    }
  })
})

describe('D1ConnectionStore.create() atomic host_id allocation (#2676)', () => {
  test('sequential creates allocate descending, distinct host ids', async () => {
    const store = new D1ConnectionStore()
    const a = await store.create('user_a', input('A1'))
    const b = await store.create('user_a', input('A2'))
    const c = await store.create('user_a', input('A3'))
    expect(a.hostId).toBe(-1000)
    expect(b.hostId).toBe(-1001)
    expect(c.hostId).toBe(-1002)
  })

  test('host ids are scoped per user', async () => {
    const store = new D1ConnectionStore()
    const a = await store.create('user_a', input('A1'))
    const b = await store.create('user_b', input('B1'))
    expect(a.hostId).toBe(-1000)
    expect(b.hostId).toBe(-1000)
  })

  test('CONCURRENT creates for the same user never share a host_id', async () => {
    const store = new D1ConnectionStore()

    // Fire both creates without awaiting between them: with the old JS-side
    // `list() → allocateDbHostId() → INSERT` sequence, both requests read the
    // same empty snapshot and inserted the SAME host_id (-1000, -1000). With
    // allocation folded into the INSERT statement, each statement observes
    // the other's committed row and the ids must differ.
    const [a, b] = await Promise.all([
      store.create('user_a', input('Race1')),
      store.create('user_a', input('Race2')),
    ])

    expect(a.hostId).not.toBe(b.hostId)
    expect([a.hostId, b.hostId].sort((x, y) => x - y)).toEqual([-1001, -1000])
    // The stored rows must agree with what the store returned.
    const storedIds = (currentDb?._rows ?? [])
      .map((r) => r.host_id)
      .sort((x, y) => x - y)
    expect(storedIds).toEqual([-1001, -1000])
  })
})

// Restore encryption key env after this file's tests.
if (originalKey === undefined) {
  delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
} else {
  process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = originalKey
}
