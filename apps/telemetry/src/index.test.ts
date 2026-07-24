import worker, { type Env } from './index'
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, it } from 'bun:test'

// ─── D1Database mock backed by a real in-memory SQLite engine ─────────────────
//
// D1 is built on SQLite, so running these queries through bun:sqlite exercises
// the exact same SQL dialect/grammar as the deployed Worker — a fake that just
// records calls would never catch a syntax error like the double-WHERE bug
// this file regression-tests (#2466).

function makeMockD1(db: Database): D1Database {
  const makeStatement = (
    sql: string,
    params: unknown[]
  ): D1PreparedStatement => {
    const statement: D1PreparedStatement = {
      bind: (...args: unknown[]) => makeStatement(sql, args),
      first: (async <T = unknown>() => {
        const row = db.query(sql).get(...params) as T | null
        return row ?? null
      }) as D1PreparedStatement['first'],
      all: (async <T = unknown>() => {
        const results = db.query(sql).all(...params) as T[]
        return { results, success: true, meta: {} } as unknown as D1Result<T>
      }) as D1PreparedStatement['all'],
      run: (async () => {
        db.run(sql, params as never)
        return { success: true, meta: {} } as unknown as D1Result
      }) as D1PreparedStatement['run'],
      raw: (async () =>
        db.query(sql).values(...params)) as D1PreparedStatement['raw'],
    }
    return statement
  }

  return {
    prepare: (sql: string) => makeStatement(sql, []),
  } as unknown as D1Database
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
}

/** 64 lowercase hex chars, matching the opaque instance/install id shape. */
function hex64(seed: string): string {
  return seed.repeat(64).slice(0, 64)
}

describe('GET /v1/summary — double WHERE regression (#2466)', () => {
  let db: Database

  afterEach(() => {
    db?.close()
  })

  function seed() {
    db = new Database(':memory:')
    db.run(`
      CREATE TABLE ping_daily (
        day           TEXT NOT NULL,
        instance_hash TEXT NOT NULL,
        deploy_target TEXT NOT NULL DEFAULT 'unknown',
        ch_version    TEXT,
        ch_flavor     TEXT,
        country       TEXT,
        platform      TEXT,
        chm_version   TEXT,
        install_place TEXT,
        PRIMARY KEY (day, instance_hash)
      )
    `)

    const insert = db.query(
      `INSERT INTO ping_daily (day, instance_hash, deploy_target, ch_version, ch_flavor, country, platform, chm_version, install_place)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // Two docker installs (one with a known install_place), one helm install.
    insert.run(
      '2026-07-01',
      hex64('a'),
      'docker',
      '24.8',
      'oss',
      'us',
      'linux',
      '0.3.1',
      hex64('1')
    )
    insert.run(
      '2026-07-01',
      hex64('b'),
      'docker',
      '24.8',
      'oss',
      'us',
      'linux',
      '0.3.1',
      null
    )
    insert.run(
      '2026-07-01',
      hex64('c'),
      'helm',
      '23.8',
      'altinity',
      'de',
      'linux',
      '0.3.0',
      hex64('2')
    )
  }

  it('returns 200 for the unscoped summary (baseline)', async () => {
    seed()
    const env: Env = { CHM_TELEMETRY_DB: makeMockD1(db) }
    const res = await worker.fetch(
      new Request('https://telemetry.chmonitor.dev/v1/summary'),
      env,
      makeCtx()
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total_installs: number
      total_places: number
      scoped_to_deploy_target: string | null
      error?: string
    }
    expect(body.error).toBeUndefined()
    expect(body.scoped_to_deploy_target).toBeNull()
    expect(body.total_installs).toBe(3)
    expect(body.total_places).toBe(2)
  })

  it('returns 200 (not 500) for ?deploy_target=docker and scopes total_places', async () => {
    seed()
    const env: Env = { CHM_TELEMETRY_DB: makeMockD1(db) }
    const res = await worker.fetch(
      new Request(
        'https://telemetry.chmonitor.dev/v1/summary?deploy_target=docker'
      ),
      env,
      makeCtx()
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total_installs: number
      total_places: number
      scoped_to_deploy_target: string | null
      by_deploy_target: Record<string, number>
      error?: string
    }
    expect(body.error).toBeUndefined()
    expect(body.scoped_to_deploy_target).toBe('docker')
    // 2 docker installs, but only 1 of them has a non-null install_place.
    expect(body.total_installs).toBe(2)
    expect(body.total_places).toBe(1)
    // by_deploy_target stays global (not scoped) so the breakdown is always visible.
    expect(body.by_deploy_target).toEqual({ docker: 2, helm: 1 })
  })

  it('scopes total_places to a different deploy_target independently', async () => {
    seed()
    const env: Env = { CHM_TELEMETRY_DB: makeMockD1(db) }
    const res = await worker.fetch(
      new Request(
        'https://telemetry.chmonitor.dev/v1/summary?deploy_target=helm'
      ),
      env,
      makeCtx()
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      total_installs: number
      total_places: number
    }
    expect(body.total_installs).toBe(1)
    expect(body.total_places).toBe(1)
  })
})

describe('POST /v1/event — bounded, deduped insert (#2503)', () => {
  let db: Database

  afterEach(() => {
    db?.close()
  })

  // Mirrors migrations/0003_create_views.sql (events table) +
  // migrations/0004_dedupe_events.sql (dedup unique index).
  function seed() {
    db = new Database(':memory:')
    db.run(`
      CREATE TABLE events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        day           TEXT NOT NULL,
        event         TEXT NOT NULL,
        deploy_target TEXT,
        ch_version    TEXT,
        ch_flavor     TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.run(`
      CREATE UNIQUE INDEX idx_events_dedupe
        ON events (
          day, event, deploy_target, COALESCE(ch_version, ''), COALESCE(ch_flavor, '')
        )
    `)
  }

  function post(body: unknown) {
    const env: Env = { CHM_TELEMETRY_DB: makeMockD1(db) }
    return worker.fetch(
      new Request('https://telemetry.chmonitor.dev/v1/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      makeCtx()
    )
  }

  function countEvents(): number {
    return (db.query('SELECT COUNT(*) AS n FROM events').get() as { n: number })
      .n
  }

  it('dedupes an identical event posted twice on the same day', async () => {
    seed()
    // No ch_version -> stored as NULL. Regression check for the COALESCE fix:
    // a plain UNIQUE index would never dedupe two NULLs against each other.
    const payload = { event: 'app_loaded', props: { deploy_target: 'docker' } }

    const first = await post(payload)
    const second = await post(payload)

    expect(first.status).toBe(204)
    expect(second.status).toBe(204)
    expect(countEvents()).toBe(1)
  })

  it('stores separate rows for two different event names', async () => {
    seed()
    await post({ event: 'app_loaded', props: { deploy_target: 'docker' } })
    await post({ event: 'health_viewed', props: { deploy_target: 'docker' } })

    expect(countEvents()).toBe(2)
  })

  it('stores separate rows when ch_version differs (incl. set vs. absent)', async () => {
    seed()
    await post({
      event: 'cluster_connected',
      props: { deploy_target: 'docker', ch_version: '24.8' },
    })
    await post({
      event: 'cluster_connected',
      props: { deploy_target: 'docker' }, // no ch_version -> NULL
    })

    expect(countEvents()).toBe(2)
  })

  it('rejects an unknown event name and inserts nothing', async () => {
    seed()
    const res = await post({ event: 'not_a_real_event', props: {} })

    expect(res.status).toBe(400)
    expect(countEvents()).toBe(0)
  })

  it('does not dedupe the same event across different days', () => {
    // /v1/event derives `day` from wall-clock time, not a request field, so
    // the day dimension of the key is exercised directly at the storage
    // layer with the same INSERT OR IGNORE statement the handler issues.
    seed()
    const insert = db.query(
      'INSERT OR IGNORE INTO events (day, event, deploy_target, ch_version, ch_flavor) VALUES (?, ?, ?, ?, ?)'
    )
    insert.run('2026-07-01', 'app_loaded', 'docker', null, 'oss')
    insert.run('2026-07-02', 'app_loaded', 'docker', null, 'oss')

    expect(countEvents()).toBe(2)
  })
})

describe('POST /v1/cli — separate CLI tracking stream', () => {
  let db: Database

  afterEach(() => {
    db?.close()
  })

  // Mirrors migrations/0005_cli_events.sql.
  function seed() {
    db = new Database(':memory:')
    db.run(`
      CREATE TABLE cli_daily (
        day         TEXT NOT NULL,
        install_id  TEXT NOT NULL,
        event       TEXT NOT NULL,
        command     TEXT NOT NULL DEFAULT '',
        cli_version TEXT,
        os          TEXT,
        arch        TEXT,
        PRIMARY KEY (day, install_id, event, command)
      )
    `)
  }

  function post(body: unknown) {
    const env: Env = { CHM_TELEMETRY_DB: makeMockD1(db) }
    return worker.fetch(
      new Request('https://telemetry.chmonitor.dev/v1/cli', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      makeCtx()
    )
  }

  const countCli = () =>
    (db.query('SELECT COUNT(*) AS n FROM cli_daily').get() as { n: number }).n

  it('accepts a valid cli_run ping', async () => {
    seed()
    const res = await post({
      install_id: hex64('a'),
      event: 'cli_run',
      command: 'diagnose',
      cli_version: '0.1.0',
      os: 'linux',
      arch: 'x86_64',
    })
    expect(res.status).toBe(204)
    expect(countCli()).toBe(1)
  })

  it('rejects a malformed install_id and inserts nothing', async () => {
    seed()
    const res = await post({ install_id: 'nope', event: 'cli_run' })
    expect(res.status).toBe(400)
    expect(countCli()).toBe(0)
  })

  it('rejects an unknown event name', async () => {
    seed()
    const res = await post({ install_id: hex64('b'), event: 'cli_hack' })
    expect(res.status).toBe(400)
    expect(countCli()).toBe(0)
  })

  it('coerces unknown command/os/arch to safe defaults', async () => {
    seed()
    await post({
      install_id: hex64('c'),
      event: 'cli_run',
      command: 'rm-rf',
      os: 'plan9',
      arch: 'sparc',
    })
    const row = db.query('SELECT command, os, arch FROM cli_daily').get() as {
      command: string
      os: string
      arch: string
    }
    expect(row.command).toBe('')
    expect(row.os).toBe('unknown')
    expect(row.arch).toBe('unknown')
  })

  it('dedupes an identical ping posted twice on the same day', async () => {
    seed()
    const payload = {
      install_id: hex64('d'),
      event: 'cli_run',
      command: 'hosts',
    }
    await post(payload)
    await post(payload)
    expect(countCli()).toBe(1)
  })
})
