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
