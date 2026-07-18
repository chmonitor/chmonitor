/**
 * Proves the production D1 UPDATE/DELETE SQL for webhook subscriptions is
 * ownership-guarded — the same IDOR class plan 04 fixed for conversations
 * (`conversation-store/d1-store.sql.test.ts`). Runs the exact exported SQL
 * strings against `bun:sqlite` (SQLite is D1's underlying engine) so the
 * guard is actually executed, not re-derived.
 */

import { installEventsPlatformMock } from './__tests__/platform-mock'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

// subscription-store.ts imports `getPlatformBindings` from '@chm/platform',
// which resolves to `platform-native.ts`'s
// `import { env } from 'cloudflare:workers'` — a virtual module `bun test`
// doesn't provide. Mock it via the shared `./__tests__/platform-mock`
// fixture (issue #2777) so the mock doesn't leak across sibling event-bus
// test files depending on execution order. The D1 binding value is
// irrelevant here — this file only needs the exported SQL string constants.
installEventsPlatformMock()

const {
  D1_UPDATE_SUBSCRIPTION_SQL,
  D1_DELETE_SUBSCRIPTION_SQL,
  D1_LIST_INSTANCE_SCOPED_SQL,
} = await import('./subscription-store')

function seed() {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE webhook_subscriptions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, url TEXT NOT NULL,
    secret TEXT NOT NULL, event_types TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, scope TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER, updated_at INTEGER)`)
  db.run(
    `INSERT INTO webhook_subscriptions VALUES
     ('sub-1','user-1','https://orig.example.com/hook','orig-secret','["connection.created"]',1,'user',1,1)`
  )
  return db
}

describe('webhook_subscriptions UPDATE guard (real SQL)', () => {
  test("a foreign user_id cannot edit another user's subscription; changes === 0", () => {
    const db = seed()
    // Bind order: url, secret, event_types, enabled, updated_at, id, user_id
    const res = db.query(D1_UPDATE_SUBSCRIPTION_SQL).run(
      'https://evil.example.com/hook',
      'stolen-secret',
      '["connection.created","connection.deleted"]',
      0,
      2,
      'sub-1',
      'user-2' // attacker's own id, not the owner's
    )
    expect(res.changes).toBe(0)

    const row = db
      .query(
        `SELECT user_id, url, secret, enabled FROM webhook_subscriptions WHERE id='sub-1'`
      )
      .get() as {
      user_id: string
      url: string
      secret: string
      enabled: number
    }
    expect(row.user_id).toBe('user-1')
    expect(row.url).toBe('https://orig.example.com/hook') // untouched
    expect(row.secret).toBe('orig-secret') // untouched — not overwritten with the attacker's
    expect(row.enabled).toBe(1)
  })

  test('the owner can update their own subscription; changes === 1', () => {
    const db = seed()
    const res = db
      .query(D1_UPDATE_SUBSCRIPTION_SQL)
      .run(
        'https://new.example.com/hook',
        'orig-secret',
        '["connection.deleted"]',
        0,
        2,
        'sub-1',
        'user-1'
      )
    expect(res.changes).toBe(1)
    const row = db
      .query(`SELECT url, enabled FROM webhook_subscriptions WHERE id='sub-1'`)
      .get() as { url: string; enabled: number }
    expect(row.url).toBe('https://new.example.com/hook')
    expect(row.enabled).toBe(0)
  })
})

describe('webhook_subscriptions DELETE guard (real SQL)', () => {
  test("a foreign user_id cannot delete another user's subscription; changes === 0", () => {
    const db = seed()
    const res = db.query(D1_DELETE_SUBSCRIPTION_SQL).run('sub-1', 'user-2')
    expect(res.changes).toBe(0)
    expect(
      db
        .query(
          `SELECT count(*) as n FROM webhook_subscriptions WHERE id='sub-1'`
        )
        .get() as { n: number }
    ).toMatchObject({ n: 1 }) // row survives
  })

  test('the owner can delete their own subscription; changes === 1', () => {
    const db = seed()
    const res = db.query(D1_DELETE_SUBSCRIPTION_SQL).run('sub-1', 'user-1')
    expect(res.changes).toBe(1)
  })
})

describe('D1_LIST_INSTANCE_SCOPED_SQL (real SQL, #2664)', () => {
  test('returns enabled instance-scoped subscriptions across MULTIPLE users — this read is deliberately NOT user-scoped', () => {
    const db = seed() // sub-1: scope='user', user-1 — must NOT be returned
    db.run(
      `INSERT INTO webhook_subscriptions VALUES
       ('sub-2','user-2','https://b.example.com/hook','secret-b','["alert.fired"]',1,'instance',2,2)`
    )
    db.run(
      `INSERT INTO webhook_subscriptions VALUES
       ('sub-3','user-3','https://c.example.com/hook','secret-c','["alert.fired","alert.resolved"]',1,'instance',3,3)`
    )
    // Disabled instance-scoped row — must NOT be returned.
    db.run(
      `INSERT INTO webhook_subscriptions VALUES
       ('sub-4','user-4','https://d.example.com/hook','secret-d','["alert.fired"]',0,'instance',4,4)`
    )

    const rows = db.query(D1_LIST_INSTANCE_SCOPED_SQL).all() as {
      id: string
      user_id: string
      scope: string
    }[]

    expect(rows.map((r) => r.id).sort()).toEqual(['sub-2', 'sub-3'])
    // Different owning users, both returned by the SAME query — proves the
    // read crosses ownership, unlike every other subscription-store query.
    expect(new Set(rows.map((r) => r.user_id))).toEqual(
      new Set(['user-2', 'user-3'])
    )
  })

  test('a plain (default) scope="user" subscription is excluded even if it lists alert.fired', () => {
    const db = seed()
    db.run(
      `UPDATE webhook_subscriptions SET event_types = '["alert.fired"]' WHERE id = 'sub-1'`
    )
    const rows = db.query(D1_LIST_INSTANCE_SCOPED_SQL).all()
    expect(rows).toHaveLength(0)
  })
})
