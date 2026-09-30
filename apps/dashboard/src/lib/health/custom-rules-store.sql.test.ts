/**
 * Proves the production D1 DELETE SQL for custom alert rules is
 * ownership-guarded — the same IDOR class plan 04 fixed for conversations
 * (`conversation-store/d1-store.sql.test.ts`) and plan 44 fixed for webhook
 * subscriptions (`events/subscription-store.sql.test.ts`). Runs the exact
 * exported SQL string against `bun:sqlite` (SQLite is D1's underlying
 * engine) so the guard is actually executed, not re-derived.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../db/conversations-migrations', import.meta.url)
)

// custom-rules-store.ts imports `getPlatformBindings` from '@chm/platform',
// which resolves to `platform-native.ts`'s
// `import { env } from 'cloudflare:workers'` — a virtual module `bun test`
// doesn't provide. Mock it before importing, mirroring the established
// pattern in `subscription-store.sql.test.ts`. The D1 binding value is
// irrelevant here — this file only needs the exported SQL string constant.
installHealthPlatformMock(() => undefined)

const { D1_DELETE_CUSTOM_RULE_SQL } = await import('./custom-rules-store')

function seed() {
  const db = new Database(':memory:')
  // The committed migrations, in order: 0014 creates the table, 0032 rebuilds
  // it with `check_id` (#3438).
  for (const file of [
    '0014_custom_alert_rules.sql',
    '0032_custom_alert_rules_check_alerts.sql',
  ]) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))
  }
  db.run(
    `INSERT INTO custom_alert_rules
       (id, owner_id, name, metric, op, warning, critical, enabled, created_at)
     VALUES ('custom:rule-1','owner-1','Too many stuck merges','stuck-merges','>=',1,3,1,1)`
  )
  // A built-in check alert row (#3438): same owner, no metric/thresholds.
  db.run(
    `INSERT INTO custom_alert_rules (id, owner_id, name, enabled, created_at, check_id)
     VALUES ('check:row-1','owner-1','Parts per partition',1,1,'max-parts')`
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

  test('the custom-rule DELETE cannot remove a check alert row (#3438)', () => {
    const db = seed()
    const res = db
      .query(D1_DELETE_CUSTOM_RULE_SQL)
      .run('check:row-1', 'owner-1')
    expect(res.changes).toBe(0)
    const row = db
      .query(`SELECT check_id FROM custom_alert_rules WHERE id='check:row-1'`)
      .get() as { check_id: string }
    expect(row.check_id).toBe('max-parts')
  })
})

describe('migration 0032 (#3438)', () => {
  test('keeps existing rules and adds the (owner_id, check_id) unique index', () => {
    const db = new Database(':memory:')
    db.exec(
      readFileSync(join(MIGRATIONS_DIR, '0014_custom_alert_rules.sql'), 'utf-8')
    )
    db.run(
      `INSERT INTO custom_alert_rules VALUES
       ('custom:old','owner-1','Old','stuck-merges','>=',1,3,0,7)`
    )
    db.exec(
      readFileSync(
        join(MIGRATIONS_DIR, '0032_custom_alert_rules_check_alerts.sql'),
        'utf-8'
      )
    )
    expect(db.query(`SELECT * FROM custom_alert_rules`).all()).toEqual([
      {
        id: 'custom:old',
        owner_id: 'owner-1',
        name: 'Old',
        metric: 'stuck-merges',
        op: '>=',
        warning: 1,
        critical: 3,
        enabled: 0,
        created_at: 7,
        check_id: null,
      },
    ])
    const indexes = (
      db.query(`PRAGMA index_list('custom_alert_rules')`).all() as {
        name: string
        unique: number
      }[]
    ).map((i) => `${i.name}:${i.unique}`)
    expect(indexes).toContain('idx_custom_alert_rules_owner_id:0')
    expect(indexes).toContain('idx_custom_alert_rules_owner_check_id:1')
    const insertCheck = () =>
      db.run(
        `INSERT INTO custom_alert_rules (id, owner_id, name, created_at, check_id)
         VALUES (?1, 'owner-1', 'n', 1, 'max-parts')`,
        [`check:${Math.random()}`]
      )
    insertCheck()
    expect(insertCheck).toThrow()
  })
})
