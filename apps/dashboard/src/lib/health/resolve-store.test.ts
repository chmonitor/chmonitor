/**
 * #3493 — the health/alert stores resolve D1 → Postgres → none. They do NOT
 * follow `resolveStateBackend()` (which puts ClickHouse before Postgres):
 * there is no ClickHouse alert store, so a ClickHouse+Postgres deployment must
 * still get Postgres alerts, and a ClickHouse-only one fails closed.
 */

import { getHealthDb, resolveHealthBackend } from './resolve-store'
import { isPostgresHealthDb } from './sql-db'
import { describe, expect, test } from 'bun:test'

const CH = { CHM_STATE_CLICKHOUSE_URL: 'http://ch:8123' }
const PG = { DATABASE_URL: 'postgres://u:p@pg:5432/chm' }
const fakeD1 = {
  prepare: () => ({}),
  batch: async () => [],
} as unknown as D1Database

describe('resolveHealthBackend / getHealthDb matrix', () => {
  for (const d1 of [false, true])
    for (const ch of [false, true])
      for (const pg of [false, true]) {
        // ClickHouse never contributes: health has no ClickHouse store.
        const expected = d1 ? 'd1' : pg ? 'postgres' : null
        test(`D1=${d1} CH=${ch} PG=${pg} → ${expected}`, () => {
          const env = { ...(ch ? CH : {}), ...(pg ? PG : {}) }
          const probe = (name: string) =>
            d1 && name === 'CHM_CLOUD_D1' ? fakeD1 : null

          expect(resolveHealthBackend({ env, probe })).toBe(expected)
          const db = getHealthDb({ env, probe })
          if (expected === 'd1') expect(db).toBe(fakeD1)
          else if (expected === 'postgres')
            expect(isPostgresHealthDb(db)).toBe(true)
          else expect(db).toBeNull()
        })
      }

  test('ClickHouse-only is the known gap: fails closed for alerts', () => {
    expect(resolveHealthBackend({ env: CH, probe: () => null })).toBeNull()
  })

  test('binding order is honoured (MAINTENANCE_D1 before CHM_CLOUD_D1)', () => {
    const maint = { tag: 'maint' } as unknown as D1Database
    const main = { tag: 'main' } as unknown as D1Database
    const probe = (name: string) =>
      name === 'MAINTENANCE_D1' ? maint : name === 'CHM_CLOUD_D1' ? main : null
    expect(
      getHealthDb({ bindingNames: ['MAINTENANCE_D1', 'CHM_CLOUD_D1'], probe })
    ).toBe(maint)
    expect(getHealthDb({ probe })).toBe(main)
  })

  test('default platform probe with nothing bound fails closed', () => {
    expect(resolveHealthBackend({ env: {} })).toBeNull()
    expect(getHealthDb({ env: {} })).toBeNull()
  })

  test('one shared Postgres adapter per URL', () => {
    const probe = () => null
    const a = getHealthDb({ env: PG, probe })
    const b = getHealthDb({ env: PG, probe })
    expect(a).toBe(b)
    const c = getHealthDb({ env: { DATABASE_URL: 'postgres://other' }, probe })
    expect(c).not.toBe(a)
  })
})
