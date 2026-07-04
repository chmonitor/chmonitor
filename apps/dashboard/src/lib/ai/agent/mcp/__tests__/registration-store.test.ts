/**
 * Proves the MCP registration store enforces per-user isolation and the
 * ownership guard, and round-trips encrypted auth secrets.
 *
 * The store's SQL runs against `bun:sqlite` (D1's underlying engine) through a
 * tiny D1-shaped shim, so the real `WHERE user_id = ?` scoping, the
 * `ON CONFLICT ... WHERE user_id = excluded.user_id` guard, and the
 * `changes === 0/1` semantics the `written`/`deleted` flags depend on are
 * actually executed rather than re-derived. Mirrors
 * `conversation-store/d1-store.sql.test.ts`.
 */

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

// One shared in-memory DB for the process: the store's lazy `CREATE TABLE IF
// NOT EXISTS` migration is single-flight (cached per process), so a fresh DB
// per test would not get re-migrated. We create the table up front and clear
// rows between tests instead.
const db = new Database(':memory:')
db.run(`CREATE TABLE mcp_server_registrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'http',
  auth_kind TEXT NOT NULL DEFAULT 'none',
  auth_secret TEXT,
  auth_header_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  capabilities_json TEXT,
  last_validated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`)

/** Minimal D1Database shim over bun:sqlite (prepare/bind/run/all/first). */
function makeD1(): D1Database {
  return {
    prepare(sql: string) {
      let params: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          params = args
          return stmt
        },
        run() {
          const res = db.query(sql).run(...(params as never[]))
          return Promise.resolve({ meta: { changes: res.changes } })
        },
        all<T>() {
          return Promise.resolve({
            results: db.query(sql).all(...(params as never[])) as T[],
          })
        },
        first<T>() {
          return Promise.resolve(
            (db.query(sql).get(...(params as never[])) ?? null) as T | null
          )
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => makeD1() }),
}))

// A dedicated encryption key so the secret round-trip test needs no Clerk env
// (32 zero-bytes, base64). Set before importing the store/crypto.
process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = btoa(
  String.fromCharCode(...new Uint8Array(32))
)

const { McpRegistrationStore, D1_UPSERT_MCP_REGISTRATION_SQL } = await import(
  '../registration-store'
)

const store = new McpRegistrationStore()

function baseReg(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    userId: 'user-a',
    name: 'server',
    url: 'https://mcp.example.com/mcp',
    transport: 'http' as const,
    authKind: 'none' as const,
    enabled: true,
    ...over,
  }
}

beforeEach(() => {
  db.run('DELETE FROM mcp_server_registrations')
})

describe('per-user isolation', () => {
  test('user B cannot read user A’s registration', async () => {
    await store.upsert(baseReg())
    expect(await store.get('user-a', 'r1')).not.toBeNull()
    expect(await store.get('user-b', 'r1')).toBeNull()
    expect(await store.listForUser('user-b')).toEqual([])
    expect((await store.listForUser('user-a')).map((r) => r.id)).toEqual(['r1'])
  })

  test('user B cannot delete user A’s registration', async () => {
    await store.upsert(baseReg())
    expect(await store.remove('user-b', 'r1')).toEqual({ deleted: false })
    expect(await store.get('user-a', 'r1')).not.toBeNull()
    expect(await store.remove('user-a', 'r1')).toEqual({ deleted: true })
    expect(await store.get('user-a', 'r1')).toBeNull()
  })

  test('user B cannot rename/disable user A’s registration', async () => {
    await store.upsert(baseReg({ name: 'orig' }))
    expect(await store.patch('user-b', 'r1', { name: 'hijacked' })).toEqual({
      updated: false,
    })
    const row = await store.get('user-a', 'r1')
    expect(row?.name).toBe('orig')
    expect(row?.enabled).toBe(true)
  })
})

describe('owner-guarded upsert', () => {
  test('returns { written: false } for a foreign id and leaves the row intact', async () => {
    await store.upsert(baseReg({ name: 'orig' }))
    const res = await store.upsert(
      baseReg({ userId: 'user-b', name: 'hijacked' })
    )
    expect(res).toEqual({ written: false })
    const row = await store.get('user-a', 'r1')
    expect(row?.userId).toBe('user-a')
    expect(row?.name).toBe('orig')
  })

  test('the owner can update; { written: true }', async () => {
    await store.upsert(baseReg({ name: 'orig' }))
    expect(await store.upsert(baseReg({ name: 'renamed' }))).toEqual({
      written: true,
    })
    expect((await store.get('user-a', 'r1'))?.name).toBe('renamed')
  })

  test('a new id inserts; { written: true }', async () => {
    expect(await store.upsert(baseReg({ id: 'r2' }))).toEqual({ written: true })
  })

  // The exact production SQL string, run raw — mirrors d1-store.sql.test.ts.
  test('raw upsert SQL blocks a foreign owner (changes === 0)', () => {
    db.run(
      `INSERT INTO mcp_server_registrations
       (id, user_id, name, url, transport, auth_kind, enabled, created_at, updated_at)
       VALUES ('r1','user-a','orig','https://x/mcp','http','none',1,1,1)`
    )
    const res = db
      .query(D1_UPSERT_MCP_REGISTRATION_SQL)
      .run(
        'r1',
        'user-b',
        'hijacked',
        'https://y/mcp',
        'http',
        'none',
        null,
        null,
        1,
        null,
        null,
        2,
        2
      )
    expect(res.changes).toBe(0)
    const row = db
      .query(`SELECT user_id, name FROM mcp_server_registrations WHERE id='r1'`)
      .get() as { user_id: string; name: string }
    expect(row.user_id).toBe('user-a')
    expect(row.name).toBe('orig')
  })
})

describe('secret hygiene + connect inputs', () => {
  test('encrypts the token at rest; metadata omits it; loader decrypts it', async () => {
    await store.upsert(
      baseReg({ authKind: 'bearer', authSecret: 'super-secret-token' })
    )

    // Stored ciphertext is not the plaintext.
    const raw = db
      .query(`SELECT auth_secret FROM mcp_server_registrations WHERE id='r1'`)
      .get() as { auth_secret: string }
    expect(raw.auth_secret).not.toContain('super-secret-token')

    // Metadata projection never carries the secret, only hasSecret.
    const meta = await store.get('user-a', 'r1')
    expect(meta?.hasSecret).toBe(true)
    expect(JSON.stringify(meta)).not.toContain('super-secret-token')

    // Loader decrypts for outbound use.
    const inputs = await store.listEnabledConnectInputs('user-a')
    expect(inputs).toEqual([
      {
        id: 'r1',
        name: 'server',
        url: 'https://mcp.example.com/mcp',
        transport: 'http',
        auth: { kind: 'bearer', token: 'super-secret-token' },
      },
    ])
  })

  test('disabled registrations are excluded from connect inputs', async () => {
    await store.upsert(baseReg({ id: 'on', enabled: true }))
    await store.upsert(baseReg({ id: 'off', enabled: false }))
    const inputs = await store.listEnabledConnectInputs('user-a')
    expect(inputs.map((i) => i.id)).toEqual(['on'])
  })
})
