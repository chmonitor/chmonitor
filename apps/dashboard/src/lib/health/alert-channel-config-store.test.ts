/**
 * Fail-open + round-trip tests for the D1-backed channel config store (#2665),
 * mirroring `alert-routing.test.ts`'s fake-D1 pattern: `@chm/platform` is mocked
 * once at module load with a mutable `currentDb` the tests swap out.
 *
 * The WRITE-ONLY secret's keep-on-empty semantics live in the ON CONFLICT SQL
 * and are proven in `alert-channel-config-store.sql.test.ts` (real SQLite) — the
 * naive fake here just stores what it's given, so these tests always pass a
 * concrete secret.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { beforeEach, describe, expect, test } from 'bun:test'

interface FakeRow {
  owner_id: string
  channel: string
  enabled: number
  min_severity: string | null
  target_json: string | null
  secret: string | null
  updated_at: number
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
                owner_id,
                channel,
                enabled,
                min_severity,
                target_json,
                secret,
                updated_at,
              ] = params as [
                string,
                string,
                number,
                string | null,
                string | null,
                string | null,
                number,
              ]
              // Naive upsert by (owner, channel) — keep-on-empty is proven in
              // the SQL test, so this fake just replaces wholesale.
              const idx = rows.findIndex(
                (r) => r.owner_id === owner_id && r.channel === channel
              )
              const next: FakeRow = {
                owner_id,
                channel,
                enabled,
                min_severity,
                target_json,
                secret: secret || null,
                updated_at,
              }
              if (idx >= 0) rows[idx] = next
              else rows.push(next)
              return { meta: { changes: 1 } }
            }
            if (isDelete) {
              const [owner_id, channel] = params as [string, string]
              const before = rows.length
              const remaining = rows.filter(
                (r) => !(r.owner_id === owner_id && r.channel === channel)
              )
              rows.length = 0
              rows.push(...remaining)
              return { meta: { changes: before - rows.length } }
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

installHealthPlatformMock(() => currentDb)

const {
  deleteChannelConfig,
  getChannelConfig,
  listChannelConfigs,
  upsertChannelConfig,
} = await import('./alert-channel-config-store')

beforeEach(() => {
  currentDb = null
})

describe('alert-channel-config-store — fail-open', () => {
  test('listChannelConfigs returns [] when no D1 binding (self-hosted/OSS)', async () => {
    currentDb = null
    expect(await listChannelConfigs('')).toEqual([])
  })

  test('listChannelConfigs never throws when D1 itself throws', async () => {
    currentDb = makeThrowingD1()
    await expect(listChannelConfigs('owner-1')).resolves.toEqual([])
  })

  test('upsertChannelConfig returns null when no D1 binding', async () => {
    currentDb = null
    expect(
      await upsertChannelConfig({
        ownerId: '',
        channel: 'webhook',
        enabled: true,
        target: { url: 'https://hooks.slack.com/x' },
      })
    ).toBeNull()
  })

  test('upsertChannelConfig returns null (never throws) when D1 throws', async () => {
    currentDb = makeThrowingD1()
    await expect(
      upsertChannelConfig({
        ownerId: 'o',
        channel: 'opsgenie',
        enabled: true,
        target: { region: 'eu' },
        secret: 'k',
      })
    ).resolves.toBeNull()
  })

  test('deleteChannelConfig returns false when no D1 binding', async () => {
    currentDb = null
    expect(await deleteChannelConfig('', 'webhook')).toBe(false)
  })
})

describe('alert-channel-config-store — round-trip', () => {
  test('upsert -> list -> get, owner-scoped, parses target + secret', async () => {
    currentDb = makeFakeD1()

    const saved = await upsertChannelConfig({
      ownerId: 'owner-1',
      channel: 'telegram',
      enabled: true,
      minSeverity: 'critical',
      target: { chatId: '-100' },
      secret: '123:ABC',
    })
    expect(saved?.channel).toBe('telegram')
    expect(saved?.enabled).toBe(true)
    expect(saved?.minSeverity).toBe('critical')
    expect(saved?.target).toEqual({ chatId: '-100' })
    expect(saved?.secret).toBe('123:ABC')

    // A different owner sees nothing.
    expect(await listChannelConfigs('owner-2')).toEqual([])

    const got = await getChannelConfig('owner-1', 'telegram')
    expect(got?.secret).toBe('123:ABC')

    expect(await deleteChannelConfig('owner-1', 'telegram')).toBe(true)
    expect(await listChannelConfigs('owner-1')).toEqual([])
  })

  test('reserved sentinel rows (e.g. __digest__) never leak into listChannelConfigs', async () => {
    const db = makeFakeD1()
    currentDb = db
    await upsertChannelConfig({
      ownerId: 'o',
      channel: 'webhook',
      enabled: true,
      target: { url: 'https://example.com/hook' },
    })
    // The digest settings store parks its config in the same table under a
    // reserved channel key — it must never surface as a channel config (it
    // would leak into GET /alert-config and the sweep's channel-settings map).
    db._rows.push({
      owner_id: 'o',
      channel: '__digest__',
      enabled: 1,
      min_severity: null,
      target_json: JSON.stringify({ windowMinutes: '15' }),
      secret: null,
      updated_at: 1,
    })
    const listed = await listChannelConfigs('o')
    expect(listed.map((c) => c.channel)).toEqual(['webhook'])
  })

  test('upsert drops empty/whitespace target fields', async () => {
    currentDb = makeFakeD1()
    const saved = await upsertChannelConfig({
      ownerId: 'o',
      channel: 'twilio',
      enabled: true,
      target: { accountSid: '  AC1  ', from: '+1555', to: '   ' },
      secret: 'tok',
    })
    expect(saved?.target).toEqual({ accountSid: 'AC1', from: '+1555' })
  })

  test('an invalid minSeverity is stored as null (inherit)', async () => {
    currentDb = makeFakeD1()
    const saved = await upsertChannelConfig({
      ownerId: 'o',
      channel: 'ntfy',
      enabled: true,
      minSeverity: 'bogus' as unknown as 'warning',
      target: { url: 'https://ntfy.sh/t' },
    })
    expect(saved?.minSeverity).toBeNull()
  })
})
