/**
 * Proves the production audit-export SQL actually enforces org isolation —
 * the CRITICAL invariant from plans/22-audit-log-export.md: "a user in org A
 * must NEVER be able to export org B's rows."
 *
 * A hand-rolled fake D1 (a JS array filtered in test code) would test the
 * test's own re-implementation of the filter, not the real query — it could
 * drift from production and still pass. This instead runs the exact
 * `AUDIT_EXPORT_SELECT_SQL` string against `bun:sqlite` (SQLite is D1's
 * underlying engine), seeded with rows from two different orgs, so isolation
 * is proven against the real WHERE clause. Mirrors the established pattern in
 * conversation-store/d1-store.sql.test.ts.
 */

import { Database } from 'bun:sqlite'
// query.ts imports `getPlatformBindings` from '@chm/platform', which resolves
// (via the tsconfig path alias) to platform-native.ts's
// `import { env } from 'cloudflare:workers'` — a virtual module `bun test`
// doesn't provide (only Vite/workerd do). Mock it before importing, mirroring
// d1-store.sql.test.ts's established pattern. The D1 binding value is
// irrelevant here — this file only needs the exported SQL string constant.
import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => undefined,
  }),
}))

const { AUDIT_EXPORT_SELECT_SQL } = await import('./query')

function seed() {
  const db = new Database(':memory:')
  // Mirrors db/conversations-migrations/0010_audit_logs.sql exactly.
  db.run(`CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, event_time TEXT NOT NULL, org_id TEXT NOT NULL,
    user_id TEXT, event TEXT NOT NULL, resource TEXT, action TEXT NOT NULL,
    result TEXT NOT NULL, ip TEXT, metadata TEXT)`)

  const insert = db.prepare(
    `INSERT INTO audit_logs (id, event_time, org_id, user_id, event, resource, action, result, ip, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  // Same event_time window for BOTH orgs — if the query ever dropped the
  // org_id predicate (or a future edit weakened it), org B's rows would leak
  // into org A's export despite being a completely different tenant.
  insert.run(
    'a1',
    '2026-01-05T00:00:00.000Z',
    'org_A',
    'user_a',
    'member.invited',
    'user_x',
    'invite',
    'success',
    '203.0.113.1',
    null
  )
  insert.run(
    'a2',
    '2026-01-10T00:00:00.000Z',
    'org_A',
    'user_a',
    'connection.created',
    'conn_1',
    'create',
    'success',
    null,
    null
  )
  insert.run(
    'b1',
    '2026-01-05T00:00:00.000Z',
    'org_B',
    'user_b',
    'billing.checkout',
    'pro:monthly',
    'create',
    'success',
    null,
    null
  )
  insert.run(
    'b2',
    '2026-01-12T00:00:00.000Z',
    'org_B',
    'user_b',
    'member.removed',
    'user_y',
    'delete',
    'success',
    null,
    null
  )
  return db
}

function run(db: Database, orgId: string, from: string, to: string) {
  return db.query(AUDIT_EXPORT_SELECT_SQL).all(orgId, from, to) as Array<{
    event_time: string
    user_id: string | null
    event: string
    resource: string | null
    action: string
    result: string
    ip: string | null
  }>
}

describe('AUDIT_EXPORT_SELECT_SQL — org isolation (real SQL)', () => {
  test('org A export returns only org A rows, even over a range that fully covers org B too', () => {
    const db = seed()
    const rows = run(
      db,
      'org_A',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z'
    )

    expect(rows).toHaveLength(2)
    expect(
      rows.every(
        (r) => r.event === 'member.invited' || r.event === 'connection.created'
      )
    ).toBe(true)
    // Explicitly assert no org B row (by its distinctive event name) ever appears.
    expect(rows.some((r) => r.event === 'billing.checkout')).toBe(false)
    expect(rows.some((r) => r.event === 'member.removed')).toBe(false)
  })

  test('org B export returns only org B rows over the same wide range', () => {
    const db = seed()
    const rows = run(
      db,
      'org_B',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z'
    )

    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.event === 'member.invited')).toBe(false)
    expect(rows.some((r) => r.event === 'connection.created')).toBe(false)
  })

  test('an org id with no matching rows returns empty — never falls back to "all orgs"', () => {
    const db = seed()
    const rows = run(
      db,
      'org_nonexistent',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z'
    )
    expect(rows).toHaveLength(0)
  })

  test('a SQL-injection-shaped org id is bound as a literal value, not interpolated — still isolates to zero rows', () => {
    const db = seed()
    const rows = run(
      db,
      "org_A' OR '1'='1",
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z'
    )
    expect(rows).toHaveLength(0)
  })

  test('date range excludes rows outside [from, to] for the correct org', () => {
    const db = seed()
    // Only the first org_A row (Jan 5) falls in this narrower window; the
    // second (Jan 10) must be excluded.
    const rows = run(
      db,
      'org_A',
      '2026-01-01T00:00:00.000Z',
      '2026-01-06T00:00:00.000Z'
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.event).toBe('member.invited')
  })

  test('rows are ordered event_time DESC (newest first)', () => {
    const db = seed()
    const rows = run(
      db,
      'org_A',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z'
    )
    expect(rows[0]?.event).toBe('connection.created') // Jan 10, newer
    expect(rows[1]?.event).toBe('member.invited') // Jan 5, older
  })

  test('the SELECT projection matches the CSV column set exactly (no org_id/id/metadata leak)', () => {
    const db = seed()
    const rows = run(
      db,
      'org_A',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z'
    )
    const row = rows[0] as Record<string, unknown>
    expect(Object.keys(row).sort()).toEqual(
      [
        'action',
        'event',
        'event_time',
        'ip',
        'resource',
        'result',
        'user_id',
      ].sort()
    )
  })
})
