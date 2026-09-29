/**
 * #3493 — `resolveStateBackend()` is the one answer to "is there a state
 * backend?", and `metadataDb.available` is derived from it. Before this, the
 * flag re-derived the check inline and disagreed in both directions
 * (Postgres-only over-reported for alerts, ClickHouse-only under-reported).
 * The matrix walks every (D1 × ClickHouse × Postgres) combination so the
 * precedence and the flag can never drift apart again.
 */

import {
  isMetadataDbAvailable,
  resolveStateBackend,
  STATE_D1_BINDING,
  type StateBackendKind,
} from './config'
import { describe, expect, test } from 'bun:test'

const CH = { CHM_STATE_CLICKHOUSE_URL: 'http://ch:8123' }
const PG = { DATABASE_URL: 'postgres://u:p@pg:5432/chm' }

const cases: Array<{
  d1: boolean
  ch: boolean
  pg: boolean
  expected: StateBackendKind | null
}> = []
for (const d1 of [false, true])
  for (const ch of [false, true])
    for (const pg of [false, true])
      cases.push({
        d1,
        ch,
        pg,
        // Documented order: D1 → ClickHouse state → Postgres → none.
        expected: d1 ? 'd1' : ch ? 'clickhouse' : pg ? 'postgres' : null,
      })

describe('resolveStateBackend × metadataDb.available', () => {
  for (const { d1, ch, pg, expected } of cases) {
    test(`D1=${d1} CH=${ch} PG=${pg} → ${expected}`, () => {
      const env = { ...(ch ? CH : {}), ...(pg ? PG : {}) }
      const probed: string[] = []
      const hasD1 = (name: string) => {
        probed.push(name)
        return d1
      }

      expect(resolveStateBackend(env, hasD1)).toBe(expected)
      // The invariant the old inline check broke: flag ⇔ a backend resolves.
      expect(isMetadataDbAvailable(env, hasD1)).toBe(expected !== null)
      expect(probed[0]).toBe(STATE_D1_BINDING)
    })
  }

  test('POSTGRES_URL and POSTGRES_PRISMA_URL count as Postgres too', () => {
    const none = () => false
    expect(resolveStateBackend({ POSTGRES_URL: 'postgres://b' }, none)).toBe(
      'postgres'
    )
    expect(
      resolveStateBackend({ POSTGRES_PRISMA_URL: 'postgres://c' }, none)
    ).toBe('postgres')
  })

  test('blank values fail closed', () => {
    const none = () => false
    expect(
      resolveStateBackend(
        { CHM_STATE_CLICKHOUSE_URL: '  ', DATABASE_URL: ' ' },
        none
      )
    ).toBeNull()
    expect(isMetadataDbAvailable({}, none)).toBe(false)
  })
})
