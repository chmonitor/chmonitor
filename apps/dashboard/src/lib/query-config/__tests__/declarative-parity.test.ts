/**
 * Declarative ≡ TS parity, for a representative sample of configs — Plan 53.
 *
 * The catalog-wide sweeps (`declarative/catalog/flip-safety.test.ts`,
 * `getQueryConfigByName.test.ts`) already assert declarative≡TS on every
 * catalog entry (91 of the 107 shipped TS configs map into the 93-entry
 * catalog; the other 2 catalog entries are direct-import-only). This file is
 * deliberately narrower and answers a different question those sweeps
 * don't: does the
 * *resolved* SQL — the string `selectVersionedSql` actually picks for a given
 * ClickHouse server version — match between the two sources, not just the raw
 * `sql` field/array? For a `VersionedSql[]` config the raw-array deep-equal
 * used elsewhere implies this (same array in, same resolver, same output) but
 * this suite checks it directly and explicitly, per-version, for a curated set
 * spanning multiple domains and both plain-string and versioned-array SQL.
 *
 * Gap recorded (plan 53 STOP condition — "don't fabricate configs"):
 * `running-queries`, one of the plan's suggested examples, has NO declarative
 * catalog equivalent — its row-expansion panel is bespoke inline JSX, which
 * the declarative schema cannot express (see
 * docs/knowledge/declarative-config-catalog.md, "What stays TS-only"). It is
 * swapped below for `query-detail` and `query-cache` (both queries-domain,
 * both present in the catalog) so every name in REPRESENTATIVE_NAMES actually
 * exists on both sides.
 */

import { DECLARATIVE_CATALOG } from '../declarative/catalog'
import { getQueryConfigByName } from '../index'
import { describe, expect, test } from 'bun:test'
import {
  parseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'

const TS_ENV = { CHM_CONFIG_SOURCE: 'ts' } as const
const DECLARATIVE_ENV = { CHM_CONFIG_SOURCE: 'declarative' } as const

// Representative sample spanning merges/tables/system/queries/more domains.
// Every name here is confirmed present in BOTH `queries` (TS) and
// `DECLARATIVE_CATALOG` as of this writing.
const REPRESENTATIVE_NAMES = [
  'merges', // merges domain, versioned sql (2 variants)
  'replicas', // tables domain, plain string sql
  'disks', // system domain, plain string sql
  'part-info', // tables domain, versioned sql (3 variants)
  'errors', // more domain, versioned sql (2 variants)
  'query-detail', // queries domain, versioned sql (2 variants) — substitute for running-queries
  'query-cache', // queries domain, plain string sql — substitute for running-queries
  'clusters', // system domain, plain string sql
  'kafka-consumers', // system domain, versioned sql (2 variants)
  'tables-overview', // tables domain, plain string sql
] as const

// A version at (or just below) every real `since` boundary in the sample, so
// selectVersionedSql is exercised at every switch point. Mirrors the spirit of
// version-compatibility.test.ts's SUPPORTED_VERSIONS without duplicating its
// full corpus-wide sweep.
const SAMPLE_VERSIONS = [
  '19.8',
  '22.8',
  '23.8',
  '24.1',
  '24.8',
  '25.1',
] as const

describe('declarative ≡ TS parity — representative sample (plan 53)', () => {
  test('every representative name exists on both sides (no fabricated configs)', () => {
    for (const name of REPRESENTATIVE_NAMES) {
      expect(
        getQueryConfigByName(name, TS_ENV),
        `${name} missing from TS`
      ).toBeDefined()
      expect(
        DECLARATIVE_CATALOG[name],
        `${name} missing from DECLARATIVE_CATALOG`
      ).toBeDefined()
    }
  })

  test('running-queries is confirmed TS-only (the recorded gap, not silently dropped)', () => {
    expect(getQueryConfigByName('running-queries', TS_ENV)).toBeDefined()
    expect(DECLARATIVE_CATALOG['running-queries']).toBeUndefined()
  })

  for (const name of REPRESENTATIVE_NAMES) {
    describe(name, () => {
      const tsConfig = getQueryConfigByName(name, TS_ENV)
      const declConfig = getQueryConfigByName(name, DECLARATIVE_ENV)

      test('columns match', () => {
        expect(declConfig?.columns).toEqual(tsConfig?.columns)
      })

      test('columnFormats match', () => {
        expect(declConfig?.columnFormats).toEqual(tsConfig?.columnFormats)
      })

      test('resolved SQL matches for every sampled ClickHouse version', () => {
        for (const v of SAMPLE_VERSIONS) {
          const version = parseVersion(v)
          const tsSql = selectVersionedSql(tsConfig?.sql ?? '', version)
          const declSql = selectVersionedSql(declConfig?.sql ?? '', version)

          expect(declSql, `mismatch at CH ${v}`).toEqual(tsSql)
        }
      })
    })
  }
})
