/**
 * Tests for the pure alert-routing core (`matchRoutes` / `resolveTargets`) —
 * the STOP-condition proof from plans/30-per-rule-alert-routing.md: no
 * matching route (including the "no D1" empty-array case) must fall back to
 * the legacy global webhook URL exactly, so existing single-webhook
 * deployments behave unchanged.
 *
 * Also exercises the D1-backed CRUD against a small behavioral fake,
 * mirroring `alert-history-store.test.ts`'s fake-D1 pattern: `@chm/platform`
 * is mocked ONCE at module load (before the module under test is imported),
 * with a mutable `currentDb` the tests swap out — `@chm/platform` resolves
 * to `cloudflare:workers`, which isn't resolvable under `bun test` outside a
 * Workers runtime, so it must never be hit for real.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface FakeRow {
  id: string
  owner_id: string
  match_rule: string
  match_host: string
  channel_url: string
  enabled: number
  created_at: number
}

function makeFakeD1() {
  const rows: FakeRow[] = []

  function prepare(sql: string) {
    const isInsert = /^\s*INSERT INTO/i.test(sql)
    const isSelect = /^\s*SELECT/i.test(sql)
    const isDelete = /^\s*DELETE FROM/i.test(sql)

    return {
      bind(...params: unknown[]) {
        return {
          async run() {
            if (isInsert) {
              const [
                id,
                owner_id,
                match_rule,
                match_host,
                channel_url,
                enabled,
                created_at,
              ] = params as [
                string,
                string,
                string,
                string,
                string,
                number,
                number,
              ]
              rows.push({
                id,
                owner_id,
                match_rule,
                match_host,
                channel_url,
                enabled,
                created_at,
              })
              return { meta: { changes: 1 } }
            }
            if (isDelete) {
              const [id, owner_id] = params as [string, string]
              const before = rows.length
              const remaining = rows.filter(
                (r) => !(r.id === id && r.owner_id === owner_id)
              )
              const changes = before - remaining.length
              rows.length = 0
              rows.push(...remaining)
              return { meta: { changes } }
            }
            return { meta: { changes: 0 } }
          },
          async all<T>() {
            if (isSelect) {
              const [owner_id] = params as [string]
              return {
                results: rows.filter((r) => r.owner_id === owner_id) as T[],
              }
            }
            return { results: [] as T[] }
          },
        }
      },
    }
  }

  return { prepare, _rows: rows }
}

/** A D1 stand-in whose every call throws, to exercise the swallow-on-error path. */
function makeThrowingD1() {
  return {
    prepare() {
      throw new Error('boom: D1 unavailable')
    },
  }
}

let currentDb:
  | ReturnType<typeof makeFakeD1>
  | ReturnType<typeof makeThrowingD1>
  | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { createRoute, deleteRoute, listRoutes, matchRoutes, resolveTargets } =
  await import('./alert-routing')

import type { AlertRoute, RouteMatchTarget } from './alert-routing'

function route(overrides: Partial<AlertRoute> = {}): AlertRoute {
  return {
    id: 'route-1',
    ownerId: '',
    matchRule: '*',
    matchHost: '*',
    channelUrl: 'https://hooks.slack.com/services/x',
    enabled: true,
    createdAt: 0,
    ...overrides,
  }
}

const TARGET: RouteMatchTarget = {
  ruleId: 'disk-usage',
  ruleType: 'disk-usage',
  hostId: 0,
  hostName: 'prod-ch',
}

beforeEach(() => {
  currentDb = null
})

describe('matchRoutes (pure)', () => {
  test('* matches any rule and any host', () => {
    expect(matchRoutes([route()], TARGET)).toHaveLength(1)
  })

  test('matches rule by exact id', () => {
    const r = route({ matchRule: 'disk-usage' })
    expect(matchRoutes([r], TARGET)).toEqual([r])
  })

  test('matches rule by type when id differs', () => {
    const target: RouteMatchTarget = {
      ...TARGET,
      ruleId: 'disk-usage-custom',
      ruleType: 'disk-usage',
    }
    const r = route({ matchRule: 'disk-usage' })
    expect(matchRoutes([r], target)).toEqual([r])
  })

  test('matches rule via glob', () => {
    const r = route({ matchRule: 'disk-*' })
    expect(matchRoutes([r], TARGET)).toEqual([r])
  })

  test('no match on unrelated rule pattern', () => {
    const r = route({ matchRule: 'replication-*' })
    expect(matchRoutes([r], TARGET)).toEqual([])
  })

  test('matches host by id', () => {
    const r = route({ matchHost: '0' })
    expect(matchRoutes([r], TARGET)).toEqual([r])
  })

  test('matches host by name (case-insensitive)', () => {
    const r = route({ matchHost: 'PROD-CH' })
    expect(matchRoutes([r], TARGET)).toEqual([r])
  })

  test('matches host via glob', () => {
    const r = route({ matchHost: 'prod-*' })
    expect(matchRoutes([r], TARGET)).toEqual([r])
  })

  test('rule matches but host does not -> no match', () => {
    const r = route({ matchRule: 'disk-usage', matchHost: 'staging-*' })
    expect(matchRoutes([r], TARGET)).toEqual([])
  })

  test('disabled route never matches', () => {
    const r = route({ enabled: false })
    expect(matchRoutes([r], TARGET)).toEqual([])
  })

  test('empty route list matches nothing', () => {
    expect(matchRoutes([], TARGET)).toEqual([])
  })
})

describe('resolveTargets (pure)', () => {
  test('fans out to every matched route, deduplicated', () => {
    const r1 = route({ id: 'a', channelUrl: 'https://a.example/hook' })
    const r2 = route({ id: 'b', channelUrl: 'https://b.example/hook' })
    // Duplicate URL across two matching routes should collapse to one entry.
    const r3 = route({ id: 'c', channelUrl: 'https://a.example/hook' })
    expect(
      resolveTargets([r1, r2, r3], TARGET, 'https://legacy.example/hook')
    ).toEqual(['https://a.example/hook', 'https://b.example/hook'])
  })

  test('falls back to the legacy global URL when nothing matches', () => {
    const r = route({ matchRule: 'replication-*' })
    expect(resolveTargets([r], TARGET, 'https://legacy.example/hook')).toEqual([
      'https://legacy.example/hook',
    ])
  })

  test('empty route list (no D1 / owner throw) falls back to legacy URL', () => {
    expect(resolveTargets([], TARGET, 'https://legacy.example/hook')).toEqual([
      'https://legacy.example/hook',
    ])
  })

  test('no match and no legacy URL configured -> empty', () => {
    const r = route({ matchRule: 'replication-*' })
    expect(resolveTargets([r], TARGET, '')).toEqual([])
  })
})

describe('D1-backed alert-routing CRUD', () => {
  test('listRoutes returns [] when D1 binding is missing (self-hosted/OSS)', async () => {
    currentDb = null
    expect(await listRoutes('')).toEqual([])
  })

  test('listRoutes returns [] (never throws) when D1 itself throws', async () => {
    currentDb = makeThrowingD1()
    await expect(listRoutes('owner-1')).resolves.toEqual([])
  })

  test('createRoute returns null (never throws) when D1 itself throws', async () => {
    currentDb = makeThrowingD1()
    await expect(
      createRoute({
        ownerId: 'owner-1',
        matchRule: '*',
        matchHost: '*',
        channelUrl: 'https://hooks.slack.com/services/x',
      })
    ).resolves.toBeNull()
  })

  test('create -> list -> delete round-trip, owner-scoped', async () => {
    const fakeDb = makeFakeD1()
    currentDb = fakeDb

    const created = await createRoute({
      ownerId: 'owner-1',
      matchRule: 'disk-*',
      matchHost: '*',
      channelUrl: 'https://hooks.slack.com/services/x',
    })
    expect(created).not.toBeNull()
    expect(created?.ownerId).toBe('owner-1')

    // A different owner sees nothing.
    expect(await listRoutes('owner-2')).toEqual([])

    const listed = await listRoutes('owner-1')
    expect(listed).toHaveLength(1)
    expect(listed[0].matchRule).toBe('disk-*')

    // Deleting with the wrong owner is a no-op.
    expect(await deleteRoute('owner-2', created!.id)).toBe(false)
    expect(await listRoutes('owner-1')).toHaveLength(1)

    expect(await deleteRoute('owner-1', created!.id)).toBe(true)
    expect(await listRoutes('owner-1')).toEqual([])
  })
})
