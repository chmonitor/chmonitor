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
  provider: string
  service_name: string | null
  routing_key: string | null
  telegram_bot_token?: string | null
  telegram_chat_id?: string | null
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
                provider,
                service_name,
                routing_key,
                telegram_bot_token,
                telegram_chat_id,
              ] = params as [
                string,
                string,
                string,
                string,
                string,
                number,
                number,
                string,
                string | null,
                string | null,
                string | null,
                string | null,
              ]
              rows.push({
                id,
                owner_id,
                match_rule,
                match_host,
                channel_url,
                enabled,
                created_at,
                provider,
                service_name,
                routing_key,
                telegram_bot_token,
                telegram_chat_id,
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

const {
  createRoute,
  deleteRoute,
  listRoutes,
  matchRoutes,
  resolvePagerDutyTargets,
  resolveTargets,
  resolveTelegramTargets,
} = await import('./alert-routing')

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
    provider: 'webhook',
    serviceName: null,
    routingKey: null,
    telegramBotToken: null,
    telegramChatId: null,
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

  test('a matched pagerduty route is excluded from the channel list AND suppresses the legacy webhook fallback (no double-fire)', () => {
    // An operator who explicitly routed this rule/host to PagerDuty must not
    // ALSO get the legacy global webhook — a match of either provider
    // suppresses the OTHER provider's catch-all (plan 34).
    const pd = route({
      matchRule: 'disk-usage',
      provider: 'pagerduty',
      routingKey: 'R-key',
    })
    expect(resolveTargets([pd], TARGET, 'https://legacy.example/hook')).toEqual(
      []
    )
  })

  test('no match and no legacy URL configured -> empty', () => {
    const r = route({ matchRule: 'replication-*' })
    expect(resolveTargets([r], TARGET, '')).toEqual([])
  })
})

describe('resolvePagerDutyTargets (pure) — plan 34', () => {
  test('matches a pagerduty route and returns its service + routing key', () => {
    const r = route({
      matchRule: 'disk-usage',
      provider: 'pagerduty',
      serviceName: 'DB On-call',
      routingKey: 'R-abc',
    })
    expect(resolvePagerDutyTargets([r], TARGET, '')).toEqual([
      { serviceName: 'DB On-call', routingKey: 'R-abc' },
    ])
  })

  test('matches a pagerduty route via glob and the * host wildcard', () => {
    const r = route({
      matchRule: 'disk-*',
      matchHost: '*',
      provider: 'pagerduty',
      serviceName: 'DB On-call',
      routingKey: 'R-glob',
    })
    expect(resolvePagerDutyTargets([r], TARGET, '')).toEqual([
      { serviceName: 'DB On-call', routingKey: 'R-glob' },
    ])
  })

  test('ignores webhook-provider routes even if matched', () => {
    const r = route({ matchRule: 'disk-usage', provider: 'webhook' })
    expect(resolvePagerDutyTargets([r], TARGET, '')).toEqual([])
  })

  test('a matched webhook route suppresses the env PagerDuty fallback (no double-fire)', () => {
    // An operator who explicitly routed this rule/host to Slack/Discord must
    // not ALSO get it paged to the env-configured PagerDuty service (plan
    // 34's cross-provider suppression, symmetric with resolveTargets above).
    const webhook = route({ matchRule: 'disk-usage', provider: 'webhook' })
    expect(
      resolvePagerDutyTargets([webhook], TARGET, 'env-fallback-key')
    ).toEqual([])
  })

  test('deduplicates matched routes sharing the same routing key', () => {
    const r1 = route({
      id: 'a',
      matchRule: 'disk-usage',
      provider: 'pagerduty',
      serviceName: 'DB',
      routingKey: 'R-shared',
    })
    const r2 = route({
      id: 'b',
      matchRule: '*',
      provider: 'pagerduty',
      serviceName: 'DB (dup)',
      routingKey: 'R-shared',
    })
    expect(resolvePagerDutyTargets([r1, r2], TARGET, '')).toEqual([
      { serviceName: 'DB', routingKey: 'R-shared' },
    ])
  })

  test('a pagerduty route with no routing key never dispatches, and still suppresses the env fallback', () => {
    // A route matched this finding (by rule/host) but is misconfigured (no
    // routing key) — it counts as "this finding was explicitly routed" for
    // the fallback-suppression decision, same as any other match, so the env
    // key does NOT silently take over. This is a misconfiguration the
    // operator should notice (an unmatched route commits with no delivery),
    // not a shape the sweep should paper over by guessing a different key.
    const r = route({
      matchRule: 'disk-usage',
      provider: 'pagerduty',
      routingKey: null,
    })
    expect(resolvePagerDutyTargets([r], TARGET, 'env-fallback-key')).toEqual([])
  })

  test('falls back to the env routing key when nothing matches', () => {
    const r = route({ matchRule: 'replication-*', provider: 'pagerduty' })
    expect(resolvePagerDutyTargets([r], TARGET, 'env-fallback-key')).toEqual([
      { serviceName: 'default', routingKey: 'env-fallback-key' },
    ])
  })

  test('empty route list (no D1 / owner throw) falls back to the env key — STOP condition proof', () => {
    expect(resolvePagerDutyTargets([], TARGET, 'env-fallback-key')).toEqual([
      { serviceName: 'default', routingKey: 'env-fallback-key' },
    ])
  })

  test('no match and no env key configured -> empty (no PagerDuty dispatch)', () => {
    expect(resolvePagerDutyTargets([], TARGET, '')).toEqual([])
  })
})

describe('resolveTelegramTargets (pure) — #2655', () => {
  const ENV_FALLBACK = { botToken: 'env-tok', chatId: 'env-chat' }

  test('matches a telegram route and returns its bot token + chat id', () => {
    const r = route({
      matchRule: 'disk-usage',
      provider: 'telegram',
      telegramBotToken: '123:ABC',
      telegramChatId: '-100',
    })
    expect(resolveTelegramTargets([r], TARGET, null)).toEqual([
      { botToken: '123:ABC', chatId: '-100' },
    ])
  })

  test('matches a telegram route via glob and the * host wildcard', () => {
    const r = route({
      matchRule: 'disk-*',
      matchHost: '*',
      provider: 'telegram',
      telegramBotToken: '123:ABC',
      telegramChatId: '-100',
    })
    expect(resolveTelegramTargets([r], TARGET, null)).toEqual([
      { botToken: '123:ABC', chatId: '-100' },
    ])
  })

  test('ignores webhook-provider routes even if matched', () => {
    const r = route({ matchRule: 'disk-usage', provider: 'webhook' })
    expect(resolveTelegramTargets([r], TARGET, ENV_FALLBACK)).toEqual([])
  })

  test('a matched webhook route suppresses the env Telegram fallback (no double-fire)', () => {
    const webhook = route({ matchRule: 'disk-usage', provider: 'webhook' })
    expect(resolveTelegramTargets([webhook], TARGET, ENV_FALLBACK)).toEqual([])
  })

  test('deduplicates matched routes sharing the same token + chat id', () => {
    const r1 = route({
      id: 'a',
      matchRule: 'disk-usage',
      provider: 'telegram',
      telegramBotToken: '123:ABC',
      telegramChatId: '-100',
    })
    const r2 = route({
      id: 'b',
      matchRule: '*',
      provider: 'telegram',
      telegramBotToken: '123:ABC',
      telegramChatId: '-100',
    })
    expect(resolveTelegramTargets([r1, r2], TARGET, null)).toEqual([
      { botToken: '123:ABC', chatId: '-100' },
    ])
  })

  test('a telegram route missing token or chat id never dispatches, and still suppresses the env fallback', () => {
    const r = route({
      matchRule: 'disk-usage',
      provider: 'telegram',
      telegramBotToken: '123:ABC',
      telegramChatId: null,
    })
    expect(resolveTelegramTargets([r], TARGET, ENV_FALLBACK)).toEqual([])
  })

  test('falls back to the env config when nothing matches', () => {
    const r = route({ matchRule: 'replication-*', provider: 'telegram' })
    expect(resolveTelegramTargets([r], TARGET, ENV_FALLBACK)).toEqual([
      ENV_FALLBACK,
    ])
  })

  test('empty route list falls back to the env config', () => {
    expect(resolveTelegramTargets([], TARGET, ENV_FALLBACK)).toEqual([
      ENV_FALLBACK,
    ])
  })

  test('no match and no env config -> empty (no Telegram dispatch)', () => {
    expect(resolveTelegramTargets([], TARGET, null)).toEqual([])
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

  test('create -> list round-trip persists pagerduty provider fields', async () => {
    const fakeDb = makeFakeD1()
    currentDb = fakeDb

    const created = await createRoute({
      ownerId: 'owner-1',
      matchRule: 'disk-*',
      matchHost: '*',
      channelUrl: 'https://events.pagerduty.com/v2/enqueue',
      provider: 'pagerduty',
      serviceName: 'DB On-call',
      routingKey: 'R-abc',
    })
    expect(created?.provider).toBe('pagerduty')
    expect(created?.serviceName).toBe('DB On-call')
    expect(created?.routingKey).toBe('R-abc')

    const [listed] = await listRoutes('owner-1')
    expect(listed.provider).toBe('pagerduty')
    expect(listed.serviceName).toBe('DB On-call')
    expect(listed.routingKey).toBe('R-abc')
  })

  test('create -> list round-trip persists telegram provider fields', async () => {
    const fakeDb = makeFakeD1()
    currentDb = fakeDb

    const created = await createRoute({
      ownerId: 'owner-1',
      matchRule: 'disk-*',
      matchHost: '*',
      channelUrl: '',
      provider: 'telegram',
      telegramBotToken: '123:ABC',
      telegramChatId: '-100',
    })
    expect(created?.provider).toBe('telegram')
    expect(created?.telegramBotToken).toBe('123:ABC')
    expect(created?.telegramChatId).toBe('-100')

    const [listed] = await listRoutes('owner-1')
    expect(listed.provider).toBe('telegram')
    expect(listed.telegramBotToken).toBe('123:ABC')
    expect(listed.telegramChatId).toBe('-100')
  })

  test('legacy row with no provider column value defaults to webhook', async () => {
    const fakeDb = makeFakeD1()
    currentDb = fakeDb
    // Simulate a pre-migration row: provider/service_name/routing_key absent.
    fakeDb._rows.push({
      id: 'legacy-1',
      owner_id: 'owner-1',
      match_rule: '*',
      match_host: '*',
      channel_url: 'https://hooks.slack.com/services/x',
      enabled: 1,
      created_at: 0,
      provider: '',
      service_name: null,
      routing_key: null,
    })

    const [listed] = await listRoutes('owner-1')
    expect(listed.provider).toBe('webhook')
  })
})
