/**
 * Proves the production D1 upsert SQL enforces the ownership guard.
 *
 * {@link MemoryStore} is a `Map` and exercises none of the actual fix — the
 * `WHERE conversations.user_id = excluded.user_id` guard and the
 * `changes === 0` semantics that the `written` flag depends on live only in
 * {@link D1_UPSERT_CONVERSATION_SQL}. This runs that exact string against
 * `bun:sqlite` (SQLite is D1's underlying engine), so the fix is actually
 * executed rather than re-derived.
 */

import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

// d1-store.ts imports `getPlatformBindings` from '@chm/platform', which
// resolves (via the tsconfig path alias) to platform-native.ts's
// `import { env } from 'cloudflare:workers'` — a virtual module `bun test`
// doesn't provide (only Vite/workerd do). Mock it before importing, mirroring
// resolve-store.test.ts's established pattern. The D1 binding value is
// irrelevant here — this file only needs the exported SQL string constant.
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => undefined,
  }),
}))

const { D1_UPSERT_CONVERSATION_SQL } = await import('./d1-store')

function seed() {
  const db = new Database(':memory:')
  // PK is `id` alone — mirrors db/conversations-migrations/0001_conversations.sql
  db.run(`CREATE TABLE conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, messages TEXT,
    message_count INTEGER, created_at INTEGER, updated_at INTEGER)`)
  db.run(`INSERT INTO conversations VALUES ('c1','u1','orig','[1]',1,1,1)`)
  return db
}
// Bind order must match the ?1..?7 order in the SQL:
// (id, user_id, title, messages, message_count, created_at, updated_at)

describe('d1 upsert ownership guard (real SQL)', () => {
  test('a foreign owner cannot overwrite/seize the row; changes === 0', () => {
    const db = seed()
    const res = db
      .query(D1_UPSERT_CONVERSATION_SQL)
      .run('c1', 'u2', 'hijacked', '[]', 0, 2, 2)
    expect(res.changes).toBe(0) // guard blocked the update
    const row = db
      .query(`SELECT user_id, title, messages FROM conversations WHERE id='c1'`)
      .get() as { user_id: string; title: string; messages: string }
    expect(row.user_id).toBe('u1') // ownership intact
    expect(row.title).toBe('orig') // content intact
    expect(row.messages).toBe('[1]')
  })

  test('the owner can update; changes === 1', () => {
    const db = seed()
    const res = db
      .query(D1_UPSERT_CONVERSATION_SQL)
      .run('c1', 'u1', 'new', '[1,2]', 2, 1, 3)
    expect(res.changes).toBe(1)
    expect(
      (
        db.query(`SELECT title FROM conversations WHERE id='c1'`).get() as {
          title: string
        }
      ).title
    ).toBe('new')
  })

  test('a new id inserts; changes === 1', () => {
    const db = seed()
    expect(
      db.query(D1_UPSERT_CONVERSATION_SQL).run('c2', 'u2', 'x', '[]', 0, 4, 4)
        .changes
    ).toBe(1)
  })
})
