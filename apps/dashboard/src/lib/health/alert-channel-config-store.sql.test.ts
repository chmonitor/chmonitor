/**
 * Proves the production D1 SQL for `alert_channel_config` (feat #2665) against
 * `bun:sqlite` (SQLite is D1's underlying engine), mirroring
 * `dashboard-storage/d1-store.sql.test.ts`: run the exact exported SQL strings
 * rather than re-deriving the logic in the test.
 *
 * The load-bearing behaviour here is the WRITE-ONLY secret: on upsert, an empty
 * secret (`?6 = ''`) must KEEP the previously stored secret (so the UI can save
 * non-secret edits without re-typing it), while a non-empty value replaces it.
 */

import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

// The store imports `getPlatformBindings` from '@chm/platform', a Workers-only
// virtual module `bun test` can't resolve — mock it before importing. The
// binding value is irrelevant; this file only needs the exported SQL constants.
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => undefined }),
}))

const { D1_LIST_CHANNEL_CONFIG_SQL, D1_UPSERT_CHANNEL_CONFIG_SQL } =
  await import('./alert-channel-config-store')

function seed() {
  const db = new Database(':memory:')
  // Mirrors db/conversations-migrations/0026_alert_channel_config.sql
  db.run(`CREATE TABLE alert_channel_config (
    owner_id TEXT NOT NULL, channel TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    min_severity TEXT, target_json TEXT, secret TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, channel))`)
  return db
}

// Bind order for the upsert must match ?1..?7:
// (owner_id, channel, enabled, min_severity, target_json, secret, updated_at)

describe('alert_channel_config — upsert + write-only secret (real SQL)', () => {
  test('first upsert inserts the row with its secret', () => {
    const db = seed()
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'opsgenie',
      1,
      'critical',
      JSON.stringify({ region: 'eu' }),
      'api-key-1234',
      10
    )
    const row = db.query(D1_LIST_CHANNEL_CONFIG_SQL).get('owner-a') as Record<
      string,
      unknown
    >
    expect(row.channel).toBe('opsgenie')
    expect(row.enabled).toBe(1)
    expect(row.min_severity).toBe('critical')
    expect(row.target_json).toBe(JSON.stringify({ region: 'eu' }))
    expect(row.secret).toBe('api-key-1234')
  })

  test('an empty secret on update KEEPS the stored secret; other fields update', () => {
    const db = seed()
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'opsgenie',
      1,
      'critical',
      JSON.stringify({ region: 'eu' }),
      'api-key-1234',
      10
    )
    // Re-save with a blank secret and a changed region + enabled.
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'opsgenie',
      0,
      'warning',
      JSON.stringify({ region: 'us' }),
      '',
      20
    )
    const row = db.query(D1_LIST_CHANNEL_CONFIG_SQL).get('owner-a') as Record<
      string,
      unknown
    >
    expect(row.secret).toBe('api-key-1234') // KEPT
    expect(row.enabled).toBe(0) // updated
    expect(row.min_severity).toBe('warning') // updated
    expect(row.target_json).toBe(JSON.stringify({ region: 'us' })) // updated
    expect(row.updated_at).toBe(20)
  })

  test('a non-empty secret on update REPLACES the stored secret', () => {
    const db = seed()
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'telegram',
      1,
      null,
      JSON.stringify({ chatId: '-100' }),
      'old-token',
      10
    )
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'telegram',
      1,
      null,
      JSON.stringify({ chatId: '-100' }),
      'new-token',
      20
    )
    const row = db.query(D1_LIST_CHANNEL_CONFIG_SQL).get('owner-a') as Record<
      string,
      unknown
    >
    expect(row.secret).toBe('new-token')
  })

  test('the config is (owner_id, channel)-scoped: one row per channel per owner', () => {
    const db = seed()
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'webhook',
      1,
      null,
      '{}',
      '',
      10
    )
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-a',
      'webhook',
      1,
      null,
      '{}',
      '',
      20
    )
    // A second owner is isolated.
    db.query(D1_UPSERT_CHANNEL_CONFIG_SQL).run(
      'owner-b',
      'webhook',
      1,
      null,
      '{}',
      '',
      30
    )
    const aRows = db.query(D1_LIST_CHANNEL_CONFIG_SQL).all('owner-a')
    expect(aRows).toHaveLength(1)
    const bRows = db.query(D1_LIST_CHANNEL_CONFIG_SQL).all('owner-b')
    expect(bRows).toHaveLength(1)
  })
})
