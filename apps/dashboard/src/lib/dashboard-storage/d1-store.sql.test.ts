/**
 * Proves the production D1 SQL for dashboards enforces owner scoping on both
 * the write path (upsert) and the read path (get-by-name), and that the
 * public share-slug read only ever returns a dashboard that is actually
 * shared.
 *
 * Mirrors `conversation-store/d1-store.sql.test.ts`: runs the exact exported
 * SQL strings against `bun:sqlite` (SQLite is D1's underlying engine) rather
 * than re-deriving the guard logic in the test.
 */

import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

// d1-store.ts imports `getPlatformBindings` from '@chm/platform', which
// resolves (via the tsconfig path alias) to a Cloudflare-only virtual module
// `bun test` doesn't provide. Mock it before importing, mirroring
// conversation-store's established pattern. The D1 binding value is
// irrelevant here — this file only needs the exported SQL string constants.
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => undefined,
  }),
}))

const {
  D1_UPSERT_DASHBOARD_SQL,
  D1_GET_DASHBOARD_BY_NAME_SQL,
  D1_GET_DASHBOARD_BY_SLUG_SQL,
} = await import('./d1-store')

function seed() {
  const db = new Database(':memory:')
  // Mirrors db/conversations-migrations/0010_dashboards.sql
  db.run(`CREATE TABLE dashboards (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    layout_json TEXT NOT NULL, is_shared INTEGER NOT NULL DEFAULT 0,
    share_slug TEXT, updated_at INTEGER NOT NULL)`)
  db.run(
    `INSERT INTO dashboards VALUES ('d1','owner-a','Overview','["chart1","chart2"]',0,NULL,1)`
  )
  return db
}
// Bind order for the upsert must match ?1..?7:
// (id, owner_id, name, layout_json, is_shared, share_slug, updated_at)

describe('dashboards — write-path IDOR guard (real SQL)', () => {
  test('a foreign owner cannot overwrite/seize the row; changes === 0', () => {
    const db = seed()
    const res = db
      .query(D1_UPSERT_DASHBOARD_SQL)
      .run('d1', 'owner-b', 'hijacked', '["evil"]', 0, null, 2)
    expect(res.changes).toBe(0) // guard blocked the update

    const row = db
      .query(`SELECT owner_id, name, layout_json FROM dashboards WHERE id='d1'`)
      .get() as { owner_id: string; name: string; layout_json: string }
    expect(row.owner_id).toBe('owner-a') // ownership intact
    expect(row.name).toBe('Overview') // content intact
    expect(row.layout_json).toBe('["chart1","chart2"]')
  })

  test('the owner can update; changes === 1', () => {
    const db = seed()
    const res = db
      .query(D1_UPSERT_DASHBOARD_SQL)
      .run(
        'd1',
        'owner-a',
        'Overview',
        '["chart1","chart2","chart3"]',
        0,
        null,
        3
      )
    expect(res.changes).toBe(1)
    expect(
      (
        db.query(`SELECT layout_json FROM dashboards WHERE id='d1'`).get() as {
          layout_json: string
        }
      ).layout_json
    ).toBe('["chart1","chart2","chart3"]')
  })

  test('a new id inserts; changes === 1', () => {
    const db = seed()
    expect(
      db
        .query(D1_UPSERT_DASHBOARD_SQL)
        .run('d2', 'owner-b', 'My Dash', '[]', 0, null, 4).changes
    ).toBe(1)
  })
})

describe('dashboards — read-path IDOR guard (real SQL)', () => {
  test('owner A cannot read owner B-owned dashboard, even by the right name', () => {
    const db = seed() // 'Overview' is owned by owner-a
    const row = db
      .query(D1_GET_DASHBOARD_BY_NAME_SQL)
      .get('owner-b', 'Overview') // owner-b queries for owner-a's dashboard name
    expect(row).toBeNull()
  })

  test('the owner can read their own dashboard by name', () => {
    const db = seed()
    const row = db
      .query(D1_GET_DASHBOARD_BY_NAME_SQL)
      .get('owner-a', 'Overview') as { name: string; owner_id: string } | null
    expect(row).not.toBeNull()
    expect(row?.name).toBe('Overview')
    expect(row?.owner_id).toBe('owner-a')
  })

  test('a name that does not exist for that owner returns null', () => {
    const db = seed()
    const row = db
      .query(D1_GET_DASHBOARD_BY_NAME_SQL)
      .get('owner-a', 'Nonexistent')
    expect(row).toBeNull()
  })
})

describe('dashboards — public share-slug read (real SQL)', () => {
  test('an unshared dashboard is never returned by slug, even if the slug is known', () => {
    const db = seed()
    db.run(`UPDATE dashboards SET share_slug = 'guessed-slug' WHERE id = 'd1'`) // slug set but is_shared stays 0
    const row = db.query(D1_GET_DASHBOARD_BY_SLUG_SQL).get('guessed-slug')
    expect(row).toBeNull()
  })

  test('a shared dashboard is returned by its slug with only name + layout_json', () => {
    const db = seed()
    db.run(
      `UPDATE dashboards SET is_shared = 1, share_slug = 'real-slug' WHERE id = 'd1'`
    )
    const row = db
      .query(D1_GET_DASHBOARD_BY_SLUG_SQL)
      .get('real-slug') as Record<string, unknown> | null
    expect(row).not.toBeNull()
    expect(row?.name).toBe('Overview')
    expect(row?.layout_json).toBe('["chart1","chart2"]')
    // The projection must never leak owner identity.
    expect(Object.keys(row ?? {}).sort()).toEqual(['layout_json', 'name'])
  })

  test('revoking (is_shared=0) makes the old slug resolve to nothing', () => {
    const db = seed()
    db.run(
      `UPDATE dashboards SET is_shared = 1, share_slug = 'was-shared' WHERE id = 'd1'`
    )
    db.run(`UPDATE dashboards SET is_shared = 0 WHERE id = 'd1'`) // revoke, slug left stale for this test
    const row = db.query(D1_GET_DASHBOARD_BY_SLUG_SQL).get('was-shared')
    expect(row).toBeNull()
  })

  test('an unknown slug returns null', () => {
    const db = seed()
    const row = db.query(D1_GET_DASHBOARD_BY_SLUG_SQL).get('does-not-exist')
    expect(row).toBeNull()
  })
})
