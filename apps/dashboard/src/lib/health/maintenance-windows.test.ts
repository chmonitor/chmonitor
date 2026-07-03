/**
 * Tests for maintenance windows (plan 28).
 *
 * Two layers, mirroring server-sweep.test.ts / deployments/d1-store.test.ts:
 *  1. `isSuppressed` — the pure suppression rule, unit-tested directly (no D1)
 *     covering in-window / out-of-window / all-hosts / per-host boundaries —
 *     this is the logic the sweep's dispatch gate depends on.
 *  2. The D1-backed store (`listWindows`/`createWindow`/`deleteWindow`) via a
 *     behavioral fake of D1Database, exercising the real SQL, owner scoping,
 *     `endsAt > startsAt` validation, and the fail-open degrade when no
 *     binding is present.
 */

import type { MaintenanceWindow } from './maintenance-windows'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// --- behavioral D1 fake ------------------------------------------------------
interface FakeRow {
  id: string
  owner_id: string
  host_id: number | null
  reason: string
  starts_at: number
  ends_at: number
  created_by: string
  created_at: number
}

function makeFakeD1() {
  const rows: FakeRow[] = []

  function prepare(sql: string) {
    const isInsert = /^\s*INSERT INTO/i.test(sql)
    const isDelete = /^\s*DELETE FROM/i.test(sql)
    const isSelect = /^\s*SELECT/i.test(sql)

    return {
      bind(...args: unknown[]) {
        return {
          async run(): Promise<{ meta: { changes: number } }> {
            if (isInsert) {
              const [
                id,
                ownerId,
                hostId,
                reason,
                startsAt,
                endsAt,
                createdBy,
                createdAt,
              ] = args as [
                string,
                string,
                number | null,
                string,
                number,
                number,
                string,
                number,
              ]
              rows.push({
                id,
                owner_id: ownerId,
                host_id: hostId,
                reason,
                starts_at: startsAt,
                ends_at: endsAt,
                created_by: createdBy,
                created_at: createdAt,
              })
              return { meta: { changes: 1 } }
            }
            if (isDelete) {
              const [id, ownerId] = args as [string, string]
              const idx = rows.findIndex(
                (r) => r.id === id && r.owner_id === ownerId
              )
              if (idx >= 0) rows.splice(idx, 1)
              return { meta: { changes: idx >= 0 ? 1 : 0 } }
            }
            throw new Error(`fake D1: run() called on unexpected SQL: ${sql}`)
          },
          async all<T>(): Promise<{ results: T[] }> {
            if (!isSelect)
              throw new Error(`fake D1: all() called on non-SELECT: ${sql}`)
            const [ownerId] = args as [string]
            const filtered = rows
              .filter((r) => r.owner_id === ownerId)
              .sort((a, b) => b.starts_at - a.starts_at)
            return { results: filtered as unknown as T[] }
          },
        }
      },
    }
  }

  return {
    rows,
    prepare,
    batch: async (stmts: unknown[]) =>
      stmts.map(() => ({ meta: { changes: 0 } })),
  }
}

let fakeDb: ReturnType<typeof makeFakeD1> | null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => fakeDb,
  }),
}))

const { isSuppressed, listWindows, createWindow, deleteWindow } = await import(
  './maintenance-windows'
)

function window(over: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    id: 'w1',
    ownerId: 'owner-a',
    hostId: null,
    reason: 'deploy',
    startsAt: 1000,
    endsAt: 2000,
    createdBy: 'user_1',
    createdAt: 500,
    ...over,
  }
}

beforeEach(() => {
  fakeDb = makeFakeD1()
})

// ---------------------------------------------------------------------------
// isSuppressed — pure rule
// ---------------------------------------------------------------------------
describe('isSuppressed', () => {
  test('true when now is inside a per-host window targeting the finding host', () => {
    const windows = [window({ hostId: 3, startsAt: 1000, endsAt: 2000 })]
    expect(isSuppressed(windows, 3, 1500)).toBe(true)
  })

  test('false when now is inside the window but the window targets a different host', () => {
    const windows = [window({ hostId: 3, startsAt: 1000, endsAt: 2000 })]
    expect(isSuppressed(windows, 4, 1500)).toBe(false)
  })

  test('true when the window is host_id=null (applies to ALL hosts)', () => {
    const windows = [window({ hostId: null, startsAt: 1000, endsAt: 2000 })]
    expect(isSuppressed(windows, 42, 1500)).toBe(true)
  })

  test('false when now is before startsAt or at/after endsAt (end is exclusive)', () => {
    const windows = [window({ hostId: null, startsAt: 1000, endsAt: 2000 })]
    expect(isSuppressed(windows, 1, 999)).toBe(false)
    expect(isSuppressed(windows, 1, 2000)).toBe(false)
    expect(isSuppressed(windows, 1, 1000)).toBe(true)
    expect(isSuppressed(windows, 1, 1999)).toBe(true)
  })

  test('false for an empty window list', () => {
    expect(isSuppressed([], 1, 1500)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D1-backed store
// ---------------------------------------------------------------------------
describe('maintenance-windows d1 store', () => {
  // Each test uses a distinct owner id: `listWindows` keeps a best-effort
  // in-memory cache keyed by owner (module-level, not reset between tests),
  // so reusing an owner id across tests could read a stale cached result
  // from an earlier test instead of exercising the fake D1 fresh.

  test('create then list round-trips every field', async () => {
    const created = await createWindow({
      ownerId: 'owner-roundtrip',
      hostId: 2,
      reason: 'backup',
      startsAt: 1000,
      endsAt: 2000,
      createdBy: 'user_1',
    })

    const listed = await listWindows('owner-roundtrip')
    expect(listed).toEqual([created])
  })

  test('createWindow rejects endsAt <= startsAt', async () => {
    await expect(
      createWindow({
        ownerId: 'owner-invalid-range',
        hostId: null,
        reason: 'bad',
        startsAt: 2000,
        endsAt: 1000,
        createdBy: 'user_1',
      })
    ).rejects.toThrow()
  })

  test('listWindows only returns rows for the requested owner', async () => {
    await createWindow({
      ownerId: 'owner-scope-a',
      hostId: null,
      reason: 'a',
      startsAt: 1000,
      endsAt: 2000,
      createdBy: 'user_1',
    })
    await createWindow({
      ownerId: 'owner-scope-b',
      hostId: null,
      reason: 'b',
      startsAt: 1000,
      endsAt: 2000,
      createdBy: 'user_2',
    })

    expect((await listWindows('owner-scope-a')).map((w) => w.reason)).toEqual([
      'a',
    ])
    expect((await listWindows('owner-scope-b')).map((w) => w.reason)).toEqual([
      'b',
    ])
  })

  test("deleteWindow is owner-scoped: cannot delete another owner's window", async () => {
    const created = await createWindow({
      ownerId: 'owner-delete-a',
      hostId: null,
      reason: 'a',
      startsAt: 1000,
      endsAt: 2000,
      createdBy: 'user_1',
    })

    await deleteWindow('owner-delete-b', created.id)
    expect((await listWindows('owner-delete-a')).map((w) => w.id)).toEqual([
      created.id,
    ])

    await deleteWindow('owner-delete-a', created.id)
    expect(await listWindows('owner-delete-a')).toEqual([])
  })

  test('degrades to [] / throws-on-create (never crashes the caller) when no D1 binding is present', async () => {
    fakeDb = null

    expect(await listWindows('owner-no-binding')).toEqual([])
    await expect(
      createWindow({
        ownerId: 'owner-no-binding',
        hostId: null,
        reason: 'x',
        startsAt: 1000,
        endsAt: 2000,
        createdBy: 'user_1',
      })
    ).rejects.toThrow()
    // delete swallows the failure rather than throwing (fail-open).
    await expect(
      deleteWindow('owner-no-binding', 'missing')
    ).resolves.toBeUndefined()
  })
})
