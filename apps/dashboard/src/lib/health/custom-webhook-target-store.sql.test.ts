import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => undefined }),
}))

const {
  D1_DELETE_WEBHOOK_TARGET_SQL,
  D1_LIST_WEBHOOK_TARGETS_SQL,
  D1_UPSERT_WEBHOOK_TARGET_SQL,
} = await import('./custom-webhook-target-store')

function seed() {
  const db = new Database(':memory:')
  db.run(`CREATE TABLE alert_webhook_targets (
    owner_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    format TEXT NOT NULL DEFAULT 'auto',
    min_severity TEXT,
    title_template TEXT,
    body_template TEXT,
    headers_json TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, id)
  )`)
  return db
}

describe('alert_webhook_targets — owner-scoped URL-preserving upsert', () => {
  test('inserts a target and keeps its URL on a non-secret edit', () => {
    const db = seed()
    db.query(D1_UPSERT_WEBHOOK_TARGET_SQL).run(
      'owner-a',
      'cwt_1234567890abcdef123456',
      'team',
      'https://hooks.example.test/secret',
      1,
      'slack',
      'warning',
      '{{title}}',
      '{{label}}',
      JSON.stringify({ 'X-Source': 'chmonitor' }),
      10
    )
    db.query(D1_UPSERT_WEBHOOK_TARGET_SQL).run(
      'owner-a',
      'cwt_1234567890abcdef123456',
      'team-renamed',
      '',
      0,
      'matrix',
      'critical',
      '[{{severity}}]',
      '{{host}}',
      '{}',
      20
    )

    const row = db.query(D1_LIST_WEBHOOK_TARGETS_SQL).get('owner-a') as Record<
      string,
      unknown
    >
    expect(row.name).toBe('team-renamed')
    expect(row.url).toBe('https://hooks.example.test/secret')
    expect(row.enabled).toBe(0)
    expect(row.format).toBe('matrix')
    expect(row.min_severity).toBe('critical')
    expect(row.updated_at).toBe(20)
  })

  test('isolates the same target id by owner', () => {
    const db = seed()
    for (const [owner, url] of [
      ['owner-a', 'https://a.example.test/hook'],
      ['owner-b', 'https://b.example.test/hook'],
    ]) {
      db.query(D1_UPSERT_WEBHOOK_TARGET_SQL).run(
        owner,
        'cwt_1234567890abcdef123456',
        'team',
        url,
        1,
        'raw',
        null,
        '',
        '',
        '{}',
        10
      )
    }

    expect(db.query(D1_LIST_WEBHOOK_TARGETS_SQL).all('owner-a')).toHaveLength(1)
    expect(db.query(D1_LIST_WEBHOOK_TARGETS_SQL).all('owner-b')).toHaveLength(1)
    expect(
      (db.query(D1_LIST_WEBHOOK_TARGETS_SQL).get('owner-a') as { url: string })
        .url
    ).toBe('https://a.example.test/hook')

    db.query(D1_DELETE_WEBHOOK_TARGET_SQL).run(
      'owner-a',
      'cwt_1234567890abcdef123456'
    )
    expect(db.query(D1_LIST_WEBHOOK_TARGETS_SQL).all('owner-b')).toHaveLength(1)

    db.query(D1_DELETE_WEBHOOK_TARGET_SQL).run(
      'owner-b',
      'cwt_1234567890abcdef123456'
    )
    expect(db.query(D1_LIST_WEBHOOK_TARGETS_SQL).all('owner-b')).toHaveLength(0)
  })
})
