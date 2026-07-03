/**
 * Tests for the D1-backed alert-ack store.
 *
 * `isAcked` is pure (no I/O) and tested directly against hand-built arrays —
 * this is the function the sweep's suppression gate calls, so it must behave
 * correctly with zero D1 involved (fail-open when D1 is absent/broken).
 *
 * `ackAlert` / `listActiveAcks` / `clearAck` are exercised against a small
 * behavioral fake of D1Database (prepare/bind/run/all), mirroring
 * `alert-history-store.test.ts`'s fake-D1 pattern, to cover the upsert
 * (re-ACK), the expiry-scoped read, and the best-effort degrade to `[]` when
 * no binding is present or D1 throws.
 */

import type { AlertAck } from './alert-ack-store'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock @chm/platform BEFORE importing the store — the store's D1 getter
// resolves the binding lazily, but the module import itself pulls in
// platform-native.ts (which touches `cloudflare:workers`, unavailable
// outside a Worker runtime).
let currentDb:
  | ReturnType<typeof makeFakeD1>
  | ReturnType<typeof makeThrowingD1>
  | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { isAcked, ackAlert, listActiveAcks, clearAck } = await import(
  './alert-ack-store'
)

// --- pure isAcked -------------------------------------------------------

const ack = (over: Partial<AlertAck> = {}): AlertAck => ({
  ownerId: '',
  hostId: 0,
  ruleId: 'disk-usage',
  ackedBy: 'operator',
  ackedAt: 1_000,
  expiresAt: 2_000,
  note: '',
  ...over,
})

describe('isAcked (pure)', () => {
  test('empty list -> never acked (fail-open when D1 is unavailable)', () => {
    expect(isAcked([], 0, 'disk-usage', 1_500)).toBe(false)
  })

  test('active ack (now < expiresAt) -> acked', () => {
    expect(isAcked([ack()], 0, 'disk-usage', 1_500)).toBe(true)
  })

  test('expired ack (now >= expiresAt) -> not acked', () => {
    expect(isAcked([ack()], 0, 'disk-usage', 2_000)).toBe(false)
    expect(isAcked([ack()], 0, 'disk-usage', 3_000)).toBe(false)
  })

  test('wrong hostId -> not acked', () => {
    expect(isAcked([ack({ hostId: 1 })], 0, 'disk-usage', 1_500)).toBe(false)
  })

  test('wrong ruleId -> not acked', () => {
    expect(
      isAcked([ack({ ruleId: 'other-rule' })], 0, 'disk-usage', 1_500)
    ).toBe(false)
  })

  test('matches within a mixed list of acks', () => {
    const acks = [
      ack({ hostId: 1, ruleId: 'a' }),
      ack({ hostId: 0, ruleId: 'disk-usage', expiresAt: 5_000 }),
      ack({ hostId: 0, ruleId: 'b', expiresAt: 500 }),
    ]
    expect(isAcked(acks, 0, 'disk-usage', 1_500)).toBe(true)
  })
})

// --- behavioral D1 fake ------------------------------------------------------

interface FakeRow {
  owner_id: string
  host_id: number
  rule_id: string
  acked_by: string
  acked_at: number
  expires_at: number
  note: string
}

function makeFakeD1() {
  const rows: FakeRow[] = []

  function prepare(sql: string) {
    const isUpsert = /^\s*INSERT INTO/i.test(sql)
    const isDelete = /^\s*DELETE FROM/i.test(sql)

    return {
      bind(...args: unknown[]) {
        return {
          async run(): Promise<{ meta: { changes: number } }> {
            if (isUpsert) {
              const [
                ownerId,
                hostId,
                ruleId,
                ackedBy,
                ackedAt,
                expiresAt,
                note,
              ] = args as [
                string,
                number,
                string,
                string,
                number,
                number,
                string,
              ]
              const existing = rows.find(
                (r) =>
                  r.owner_id === ownerId &&
                  r.host_id === hostId &&
                  r.rule_id === ruleId
              )
              if (existing) {
                existing.acked_by = ackedBy
                existing.acked_at = ackedAt
                existing.expires_at = expiresAt
                existing.note = note
              } else {
                rows.push({
                  owner_id: ownerId,
                  host_id: hostId,
                  rule_id: ruleId,
                  acked_by: ackedBy,
                  acked_at: ackedAt,
                  expires_at: expiresAt,
                  note,
                })
              }
              return { meta: { changes: 1 } }
            }
            if (isDelete) {
              const [ownerId, hostId, ruleId] = args as [string, number, string]
              const idx = rows.findIndex(
                (r) =>
                  r.owner_id === ownerId &&
                  r.host_id === hostId &&
                  r.rule_id === ruleId
              )
              if (idx >= 0) rows.splice(idx, 1)
              return { meta: { changes: idx >= 0 ? 1 : 0 } }
            }
            throw new Error('fake D1: run() called on unsupported statement')
          },
          async all<T>(): Promise<{ results: T[] }> {
            const [ownerId, now] = args as [string, number]
            const filtered = rows.filter(
              (r) => r.owner_id === ownerId && r.expires_at > now
            )
            return { results: filtered as unknown as T[] }
          },
        }
      },
    }
  }

  async function batch(_stmts: unknown[]) {
    // Migration DDL is a no-op against the in-memory fake.
    return []
  }

  return { prepare, batch, _rows: rows }
}

function makeThrowingD1() {
  return {
    prepare() {
      throw new Error('boom: D1 unavailable')
    },
  }
}

beforeEach(() => {
  currentDb = makeFakeD1()
})

describe('alert-ack-store', () => {
  test('ackAlert then listActiveAcks round-trips', async () => {
    await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '15m',
      ackedBy: 'alice',
      now: 1_000,
    })

    const acks = await listActiveAcks('', 2_000)
    expect(acks).toHaveLength(1)
    expect(acks[0]).toMatchObject({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      ackedBy: 'alice',
      ackedAt: 1_000,
      expiresAt: 1_000 + 15 * 60 * 1000,
    })
  })

  test('re-ACK upserts (replaces actor + extends expiry) instead of duplicating', async () => {
    await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '5m',
      ackedBy: 'alice',
      now: 1_000,
    })
    await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '240m',
      ackedBy: 'bob',
      now: 2_000,
    })

    const acks = await listActiveAcks('', 2_500)
    expect(acks).toHaveLength(1)
    expect(acks[0].ackedBy).toBe('bob')
    expect(acks[0].expiresAt).toBe(2_000 + 240 * 60 * 1000)
  })

  test('listActiveAcks excludes expired acks', async () => {
    await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '5m',
      ackedBy: 'alice',
      now: 1_000,
    })

    const expiresAt = 1_000 + 5 * 60 * 1000
    expect(await listActiveAcks('', expiresAt - 1)).toHaveLength(1)
    expect(await listActiveAcks('', expiresAt)).toHaveLength(0)
  })

  test('listActiveAcks scopes by ownerId', async () => {
    await ackAlert({
      ownerId: 'org_a',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '15m',
      ackedBy: 'alice',
      now: 1_000,
    })
    await ackAlert({
      ownerId: 'org_b',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '15m',
      ackedBy: 'bob',
      now: 1_000,
    })

    expect(await listActiveAcks('org_a', 1_500)).toHaveLength(1)
    expect(await listActiveAcks('org_c', 1_500)).toHaveLength(0)
  })

  test('clearAck removes an active ack', async () => {
    await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '15m',
      ackedBy: 'alice',
      now: 1_000,
    })
    await clearAck('', 0, 'disk-usage')

    expect(await listActiveAcks('', 1_500)).toHaveLength(0)
  })

  test('listActiveAcks fails open ([]) when no D1 binding is configured', async () => {
    currentDb = null
    expect(await listActiveAcks('', 1_500)).toEqual([])
  })

  test('listActiveAcks fails open ([]) when D1 throws', async () => {
    currentDb = makeThrowingD1()
    expect(await listActiveAcks('', 1_500)).toEqual([])
  })

  test('clearAck never throws when no D1 binding is configured', async () => {
    currentDb = null
    await expect(clearAck('', 0, 'disk-usage')).resolves.toBeUndefined()
  })

  test('ackAlert throws when no D1 binding is configured', async () => {
    currentDb = null
    await expect(
      ackAlert({
        ownerId: '',
        hostId: 0,
        ruleId: 'disk-usage',
        durationKey: '5m',
        ackedBy: 'alice',
      })
    ).rejects.toThrow()
  })
})
