/**
 * Proves the production D1 DELETE SQL for custom alert rules is
 * ownership-guarded — the same IDOR class plan 04 fixed for conversations
 * (`conversation-store/d1-store.sql.test.ts`) and plan 44 fixed for webhook
 * subscriptions (`events/subscription-store.sql.test.ts`). Runs the exact
 * exported SQL string against `bun:sqlite` (SQLite is D1's underlying
 * engine) so the guard is actually executed, not re-derived.
 */

import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

// custom-rules-store.ts imports `getPlatformBindings` from '@chm/platform',
// which resolves to `platform-native.ts`'s
// `import { env } from 'cloudflare:workers'` — a virtual module `bun test`
// doesn't provide. Mock it before importing, mirroring the established
// pattern in `subscription-store.sql.test.ts`. The D1 binding value is
// irrelevant here — this file only needs the exported SQL string constant.
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => undefined,
  }),
}))

const { D1_DELETE_CUSTOM_RULE_SQL } = await import('./custom-rules-store')

function seed() {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE custom_alert_rules (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    metric TEXT NOT NULL, op TEXT NOT NULL, warning REAL NOT NULL,
    critical REAL NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL)`)
  db.run(
    `INSERT INTO custom_alert_rules VALUES
     ('custom:rule-1','owner-1','Too many stuck merges','stuck-merges','>=',1,3,1,1)`
  )
  return db
}

describe('custom_alert_rules DELETE guard (real SQL)', () => {
  test("a foreign owner_id cannot delete another owner's rule; changes === 0", () => {
    const db = seed()
    const res = db
      .query(D1_DELETE_CUSTOM_RULE_SQL)
      .run('custom:rule-1', 'owner-2') // attacker's own id, not the owner's
    expect(res.changes).toBe(0)

    const row = db
      .query(`SELECT owner_id FROM custom_alert_rules WHERE id='custom:rule-1'`)
      .get() as { owner_id: string }
    expect(row.owner_id).toBe('owner-1') // untouched
  })

  test('the owner can delete their own rule; changes === 1', () => {
    const db = seed()
    const res = db
      .query(D1_DELETE_CUSTOM_RULE_SQL)
      .run('custom:rule-1', 'owner-1')
    expect(res.changes).toBe(1)

    const row = db
      .query(`SELECT id FROM custom_alert_rules WHERE id='custom:rule-1'`)
      .get()
    expect(row).toBeNull()
  })

  test('deleting a non-existent id affects 0 rows', () => {
    const db = seed()
    const res = db
      .query(D1_DELETE_CUSTOM_RULE_SQL)
      .run('custom:does-not-exist', 'owner-1')
    expect(res.changes).toBe(0)
  })
})
