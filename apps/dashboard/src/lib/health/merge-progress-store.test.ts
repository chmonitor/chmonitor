import type { HealthSqlDb, HealthSqlStatement } from './sql-db'

import { computeMergeProgress, parseMergeObservations } from './merge-progress'
import {
  createMergeProgressStore,
  parseMergeSnapshot,
} from './merge-progress-store'
import { type PostgresClientLike, PostgresHealthDb } from './sql-db'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function sqliteDb(sqlite: Database, calls: string[]): HealthSqlDb {
  function statement(
    query: string,
    params: unknown[] = []
  ): HealthSqlStatement {
    return {
      bind: (...values) => statement(query, values),
      async all<T>() {
        calls.push(query)
        return {
          success: true,
          results: sqlite.query(query).all(...(params as never[])) as T[],
          meta: {},
        }
      },
      async first<T>() {
        calls.push(query)
        return sqlite.query(query).get(...(params as never[])) as T | null
      },
      async run() {
        calls.push(query)
        const r = sqlite.query(query).run(...(params as never[]))
        return { success: true, results: [], meta: { changes: r.changes } }
      },
    }
  }
  return {
    prepare: statement,
    batch: async (statements) => Promise.all(statements.map((s) => s.run())),
  }
}
const empty = { version: 0, updatedAtMs: 0, samples: [] }
const snapshot = (version: number, now: number) => ({
  version,
  updatedAtMs: now,
  samples: [],
})

describe('shared merge evidence store (real SQLite CAS)', () => {
  test('two independent stores cannot overwrite each other or save late observations', async () => {
    const sqlite = new Database(':memory:')
    const db = sqliteDb(sqlite, [])
    const a = createMergeProgressStore(() => db),
      b = createMergeProgressStore(() => db)
    expect(await a.load('host-a', 'observe')).toEqual(empty)
    expect(await b.load('host-a', 'observe')).toEqual(empty)
    expect(await a.save('host-a', empty, snapshot(1, 1000))).toBe(true)
    expect(await b.save('host-a', empty, snapshot(1, 500))).toBe(false)
    const prior = (await a.load('host-a', 'read'))!
    const results = await Promise.all([
      a.save('host-a', prior, snapshot(2, 2000)),
      b.save('host-a', prior, snapshot(2, 3000)),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const winner = (await b.load('host-a', 'read'))!
    expect(winner.version).toBe(2)
    expect(await a.save('host-a', winner, snapshot(3, 1500))).toBe(false)
    expect(await a.load('host-b', 'read')).toEqual(empty)
    sqlite.close()
  })
  test('read mode is SELECT-only even when the D1 table is missing', async () => {
    const sqlite = new Database(':memory:'),
      calls: string[] = []
    const store = createMergeProgressStore(() => sqliteDb(sqlite, calls))
    expect(await store.load('host', 'read')).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^SELECT /)
    sqlite.close()
  })
  test('the committed D1 migration supports persistence, and corrupt snapshots stay unknown', async () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(
      readFileSync(
        new URL(
          '../../db/conversations-migrations/0042_merge_progress_snapshots.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
    const store = createMergeProgressStore(() => sqliteDb(sqlite, []))
    const observations = parseMergeObservations([
      {
        database: 'example',
        table: 'events',
        result_part_name: 'p',
        elapsed: 1,
        progress: 1.0000000000000004,
        rows_read: '1',
        rows_written: '1',
        bytes_read_uncompressed: '1',
        bytes_written_uncompressed: '1',
        columns_written: '1',
      },
    ])!
    const next = computeMergeProgress(observations, empty, 10_000, 900).next
    expect(await store.save('host', empty, next)).toBe(true)
    expect(await store.load('host', 'read')).toEqual(next)
    sqlite.run(
      "UPDATE merge_progress_snapshots SET snapshot_json = '{}' WHERE host_key = 'host'"
    )
    expect(await store.load('host', 'read')).toBeNull()
    expect(parseMergeSnapshot('bad-json', 1, 1000)).toBeNull()
    expect(
      parseMergeSnapshot(JSON.stringify({ ...next, version: 9 }), 1, 10_000)
    ).toBeNull()
    sqlite.close()
  })
  test('missing metadata and read/save failures never report successful persistence', async () => {
    const absent = createMergeProgressStore(() => null)
    expect(await absent.load('host', 'observe')).toBeNull()
    expect(await absent.save('host', empty, snapshot(1, 1000))).toBe(false)
    const broken = createMergeProgressStore(() => {
      throw new Error('unavailable')
    })
    expect(await broken.load('host', 'read')).toBeNull()
    expect(await broken.save('host', empty, snapshot(1, 1000))).toBe(false)
  })
  test('Postgres read mode sends SELECT without schema bootstrap; observing bootstraps later', async () => {
    const calls: string[] = []
    const client = {
      unsafe: async (sql: string) => {
        calls.push(sql)
        return []
      },
      begin: async () => [],
    } as unknown as PostgresClientLike
    const db = new PostgresHealthDb(
      'postgres://localhost/test',
      'CREATE TABLE sentinel (id INTEGER)',
      () => client
    )
    const store = createMergeProgressStore(() => db)
    expect(await store.load('host', 'read')).toEqual(empty)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^SELECT /)
    await store.load('host', 'observe')
    expect(calls[1]).toBe('CREATE TABLE sentinel (id INTEGER)')
    expect(calls[2]).toMatch(/^SELECT /)
  })
})
