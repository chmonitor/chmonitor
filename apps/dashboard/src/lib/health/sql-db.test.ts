/**
 * #3493 — the Postgres adapter behind the health stores. A fake postgres.js
 * client records what would be sent, so these run without a database; the
 * opt-in `sql-db.postgres.test.ts` runs the real stores against Postgres.
 */

import { D1_UPSERT_CHANNEL_CONFIG_SQL } from './alert-channel-config-store'
import { D1_DELETE_CUSTOM_RULE_SQL } from './custom-rules-store'
import {
  D1_DELETE_WEBHOOK_TARGET_SQL,
  D1_LIST_WEBHOOK_TARGETS_SQL,
  D1_UPSERT_WEBHOOK_TARGET_SQL,
} from './custom-webhook-target-store'
import { HEALTH_POSTGRES_SCHEMA_SQL } from './postgres-schema'
import {
  type PostgresClientLike,
  PostgresHealthDb,
  toPostgresPlaceholders,
} from './sql-db'
import { describe, expect, test } from 'bun:test'

interface Call {
  query: string
  params?: unknown[]
  inTx: boolean
}

function fakeClient(
  opts: {
    rows?: Record<string, unknown>[]
    count?: number
    failSchemaOnce?: boolean
  } = {}
) {
  const calls: Call[] = []
  let schemaFailures = opts.failSchemaOnce ? 1 : 0
  const make = (inTx: boolean) => ({
    async unsafe(query: string, params?: unknown[]) {
      calls.push({ query, params, inTx })
      if (query === 'SCHEMA' && schemaFailures > 0) {
        schemaFailures--
        throw new Error('connection refused')
      }
      const rows = [...(opts.rows ?? [])] as Record<string, unknown>[] & {
        count?: number
      }
      rows.count = opts.count ?? rows.length
      return rows
    },
  })
  const client: PostgresClientLike = {
    ...make(false),
    async begin(fn) {
      return fn(make(true))
    },
  }
  return { client, calls }
}

describe('toPostgresPlaceholders', () => {
  test('numbered, bare, and quoted placeholders', () => {
    expect(toPostgresPlaceholders('a = ?1 AND b = ?2')).toBe(
      'a = $1 AND b = $2'
    )
    expect(toPostgresPlaceholders('a = ? AND b = ?')).toBe('a = $1 AND b = $2')
    expect(toPostgresPlaceholders("x = '?1' AND y = ?1")).toBe(
      "x = '?1' AND y = $1"
    )
    expect(toPostgresPlaceholders('id IN (?1, ?2, ?10)')).toBe(
      'id IN ($1, $2, $10)'
    )
  })

  test('every exported store SQL constant rewrites fully', () => {
    const cases: Array<[string, number]> = [
      [D1_UPSERT_CHANNEL_CONFIG_SQL, 7],
      [D1_DELETE_CUSTOM_RULE_SQL, 2],
      [D1_LIST_WEBHOOK_TARGETS_SQL, 1],
      [D1_UPSERT_WEBHOOK_TARGET_SQL, 11],
      [D1_DELETE_WEBHOOK_TARGET_SQL, 2],
    ]
    for (const [sql, binds] of cases) {
      const pg = toPostgresPlaceholders(sql)
      expect(pg).not.toContain('?')
      const max = Math.max(
        ...[...pg.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
      )
      expect(max).toBe(binds)
    }
  })
})

describe('PostgresHealthDb', () => {
  test('bootstraps the schema once, before the first statement', async () => {
    const { client, calls } = fakeClient()
    const db = new PostgresHealthDb('postgres://x', 'SCHEMA', () => client)
    await db.prepare('SELECT 1 WHERE a = ?1').bind('x').all()
    await db.prepare('SELECT 2').all()
    expect(calls.map((c) => c.query)).toEqual([
      'SCHEMA',
      'SELECT 1 WHERE a = $1',
      'SELECT 2',
    ])
  })

  test('a failed bootstrap is retried on the next call', async () => {
    const { client, calls } = fakeClient({ failSchemaOnce: true })
    const db = new PostgresHealthDb('postgres://x', 'SCHEMA', () => client)
    await expect(db.prepare('SELECT 1').all()).rejects.toThrow('refused')
    await db.prepare('SELECT 1').all()
    expect(calls.filter((c) => c.query === 'SCHEMA')).toHaveLength(2)
  })

  test('booleans bind as 1/0 and undefined is rejected like D1', async () => {
    const { client, calls } = fakeClient()
    const db = new PostgresHealthDb('postgres://x', 'SCHEMA', () => client)
    await db.prepare('INSERT ?1 ?2 ?3').bind(true, false, null).run()
    expect(calls[1].params).toEqual([1, 0, null])
    await expect(db.prepare('X ?1').bind(undefined).run()).rejects.toThrow()
  })

  test('bind() returns a new statement (prepared once, bound many)', async () => {
    const { client, calls } = fakeClient()
    const db = new PostgresHealthDb('postgres://x', 'SCHEMA', () => client)
    const stmt = db.prepare('INSERT INTO t VALUES (?1)')
    await db.batch([stmt.bind('a'), stmt.bind('b')])
    const inserts = calls.filter((c) => c.query.startsWith('INSERT'))
    expect(inserts.map((c) => c.params)).toEqual([['a'], ['b']])
    // D1's batch is atomic — it runs in one transaction here.
    expect(inserts.every((c) => c.inTx)).toBe(true)
  })

  test('D1-shaped results: all / first / run meta.changes', async () => {
    const { client } = fakeClient({
      rows: [{ id: 'a' }, { id: 'b' }],
      count: 2,
    })
    const db = new PostgresHealthDb('postgres://x', 'SCHEMA', () => client)
    const all = await db.prepare('SELECT').all<{ id: string }>()
    expect(all.results.map((r) => r.id)).toEqual(['a', 'b'])
    expect(await db.prepare('SELECT').first<{ id: string }>()).toEqual({
      id: 'a',
    })
    expect((await db.prepare('DELETE').run()).meta.changes).toBe(2)

    const empty = new PostgresHealthDb(
      'postgres://x',
      'SCHEMA',
      () => fakeClient({ count: 0 }).client
    )
    expect(await empty.prepare('SELECT').first()).toBeNull()
    expect((await empty.prepare('DELETE').run()).meta.changes).toBe(0)
  })
})

describe('HEALTH_POSTGRES_SCHEMA_SQL', () => {
  const tables = [
    'alert_routes',
    'alert_channel_config',
    'alert_state',
    'alert_events',
    'alert_acks',
    'alert_digest_buffer',
    'alert_suggestion_dismissals',
    'alert_webhook_targets',
    'custom_alert_rules',
    'maintenance_windows',
    'quiet_hours',
  ]

  test('creates every table the twelve stores use, idempotently', () => {
    for (const t of tables) {
      expect(HEALTH_POSTGRES_SCHEMA_SQL).toContain(
        `CREATE TABLE IF NOT EXISTS ${t} (`
      )
    }
    const creates =
      HEALTH_POSTGRES_SCHEMA_SQL.match(/CREATE (TABLE|INDEX) /g) ?? []
    const idempotent =
      HEALTH_POSTGRES_SCHEMA_SQL.match(
        /CREATE (TABLE|INDEX) IF NOT EXISTS /g
      ) ?? []
    expect(idempotent.length).toBe(creates.length)
  })

  test('unix-ms columns are BIGINT (Postgres INTEGER overflows on Date.now())', () => {
    for (const col of [
      'created_at',
      'updated_at',
      'notified_at',
      'first_fired_at',
      'acked_at',
      'expires_at',
      'flush_after',
      'dismissed_at',
      'starts_at',
      'ends_at',
    ]) {
      for (const m of HEALTH_POSTGRES_SCHEMA_SQL.matchAll(
        new RegExp(`\\n\\s*${col}\\s+(\\w+)`, 'g')
      )) {
        expect(`${col} ${m[1]}`).toBe(`${col} BIGINT`)
      }
    }
  })

  test('keeps the on-disk primary keys', () => {
    expect(HEALTH_POSTGRES_SCHEMA_SQL).toMatch(
      /alert_state \([\s\S]*?PRIMARY KEY \(host_id, rule_id\)/
    )
    expect(HEALTH_POSTGRES_SCHEMA_SQL).toMatch(
      /alert_acks \([\s\S]*?PRIMARY KEY \(owner_id, host_id, rule_id\)/
    )
  })
})
