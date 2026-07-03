/**
 * Tests for getQueryConfigByName registry wiring — Plan 02L-prep.
 *
 * Verifies:
 *   1. Default (ts) path is byte-identical to the existing behaviour.
 *   2. Declarative path (CHM_CONFIG_SOURCE=declarative) resolves every catalog
 *      entry and the serializable fields match the TS config.
 *   3. A name absent from the catalog falls back to the TS config.
 *   4. DECLARATIVE_CATALOG has no duplicate keys.
 *   5. A known name ('merges') is present in the catalog.
 */

import type { DeclarativeQueryConfig } from './declarative/schema'

import { DECLARATIVE_CATALOG } from './declarative/catalog'
import { getQueryConfigByName, queries } from './index'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'

const DECLARATIVE_ENV = { CHM_CONFIG_SOURCE: 'declarative' } as const
const TS_ENV = {} as const

// Serializable fields — the intersection of DeclarativeQueryConfig and
// QueryConfig that the loader carries through. Runtime-only fields
// (columnIcons, rowClassName, expandable, filterSchema, columnFilters,
// variants) are deliberately absent from the declarative schema and must not
// be compared here. (permission is carried as plain data and IS compared.)
const SERIALIZABLE_KEYS = [
  'name',
  'sql',
  'columns',
  'description',
  'docs',
  'suggestion',
  'optional',
  'tableCheck',
  'disableSqlValidation',
  'refreshInterval',
  'defaultParams',
  'columnFormats',
  'columnDescriptions',
  'columnSizing',
  'tableBehavior',
  'filterParamPresets',
  'relatedCharts',
  'card',
  'defaultView',
  'bulkActions',
  'bulkActionKey',
  'sortingFns',
  'clickhouseSettings',
  'permission',
] as const

// ---------------------------------------------------------------------------
// 1. Default (ts) path — unchanged behaviour
// ---------------------------------------------------------------------------

describe('getQueryConfigByName — default ts path', () => {
  test('returns undefined for empty name', () => {
    expect(getQueryConfigByName('')).toBeUndefined()
  })

  test('returns undefined for unknown name', () => {
    expect(getQueryConfigByName('__nonexistent__')).toBeUndefined()
  })

  test('returns the TS config for a known name with no env arg', () => {
    const ts = getQueryConfigByName('merges')
    expect(ts).toBeDefined()
    expect(ts?.name).toBe('merges')
  })

  test('returns the TS config for a known name with explicit ts env', () => {
    const ts = getQueryConfigByName('merges', TS_ENV)
    expect(ts).toBeDefined()
    expect(ts?.name).toBe('merges')
  })

  test('result identity: matches queries.find directly', () => {
    for (const q of queries) {
      const found = getQueryConfigByName(q.name, TS_ENV)
      expect(found).toBe(q) // same reference — no copy
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Declarative path — parity with TS on every catalog name
// ---------------------------------------------------------------------------

describe('getQueryConfigByName — declarative path parity', () => {
  const catalogNames = Object.keys(DECLARATIVE_CATALOG)

  test('catalog is non-empty', () => {
    expect(catalogNames.length).toBeGreaterThan(0)
  })

  // For each name in the catalog that also has a TS counterpart, the
  // serializable fields returned by the declarative path must equal those on
  // the TS config. Names present only in the catalog (new entries without a TS
  // peer) are checked for correctness separately.
  for (const name of catalogNames) {
    const tsConfig = getQueryConfigByName(name, TS_ENV)
    if (tsConfig === undefined) {
      // Catalog entry with no TS counterpart — just verify it resolves.
      test(`declarative resolves '${name}' (catalog-only entry)`, () => {
        const decl = getQueryConfigByName(name, DECLARATIVE_ENV)
        expect(decl).toBeDefined()
        expect(decl?.name).toBe(name)
      })
      continue
    }

    test(`declarative fields equal TS fields for '${name}'`, () => {
      const decl = getQueryConfigByName(name, DECLARATIVE_ENV)
      expect(decl).toBeDefined()
      expect(decl?.name).toBe(name)

      // Compare only fields where BOTH sides have a defined value.
      //
      // One intentional gap remains between TS configs and the declarative
      // schema: schema defaults — the declarative loader applies defaults
      // (e.g. optional: false) for keys the TS config leaves undefined.
      // Comparing those would be false-positives, so skip when either side is
      // undefined. (`docs` is now a plain string in the schema, so non-URL
      // help-text values round-trip and no longer need to be omitted.)
      //
      // The contract: for every field that both sides carry, the values must match.
      for (const key of SERIALIZABLE_KEYS) {
        const tsVal = (tsConfig as unknown as Record<string, unknown>)[key]
        const declVal = (decl as unknown as Record<string, unknown>)[key]
        if (tsVal === undefined || declVal === undefined) continue
        expect(declVal).toEqual(tsVal)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// 3. Declarative env — fallback for names absent from the catalog
// ---------------------------------------------------------------------------

describe('getQueryConfigByName — declarative env fallback', () => {
  test('falls back to TS config for name not in catalog', () => {
    // 'warnings' is in the TS queries array but not in the declarative catalog.
    const missingName = 'warnings'
    expect(DECLARATIVE_CATALOG[missingName]).toBeUndefined()

    const ts = getQueryConfigByName(missingName, TS_ENV)
    const decl = getQueryConfigByName(missingName, DECLARATIVE_ENV)

    // Both must resolve to the same TS config (by reference).
    expect(ts).toBeDefined()
    expect(decl).toBe(ts)
  })

  test('returns undefined for unknown name even with declarative env', () => {
    expect(
      getQueryConfigByName('__nonexistent__', DECLARATIVE_ENV)
    ).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 4. DECLARATIVE_CATALOG integrity
// ---------------------------------------------------------------------------

describe('DECLARATIVE_CATALOG integrity', () => {
  test('no duplicate keys', () => {
    // The catalog module throws on load if duplicates exist; this test
    // additionally verifies the key count equals the entry count.
    const keys = Object.keys(DECLARATIVE_CATALOG)
    const uniqueKeys = new Set(keys)
    expect(uniqueKeys.size).toBe(keys.length)
  })

  test("contains known name 'merges'", () => {
    const knownName = 'merges'
    expect(DECLARATIVE_CATALOG[knownName]).toBeDefined()
    expect(DECLARATIVE_CATALOG[knownName].name).toBe(knownName)
  })
})

// ---------------------------------------------------------------------------
// 5. Fail-closed: a malformed declarative entry must never crash the
//    resolver — it must log and fall back to the TS default instead.
// ---------------------------------------------------------------------------

describe('getQueryConfigByName — fails closed on a malformed declarative entry', () => {
  // Mutate a real, dual-sided catalog entry ('merges' has both a TS config
  // and a catalog entry) to a shape that fails schema validation, restoring
  // it after every test so the mutation never leaks into other suites.
  const targetName = 'merges'
  const original = DECLARATIVE_CATALOG[targetName]

  afterEach(() => {
    DECLARATIVE_CATALOG[targetName] = original
  })

  test('does not throw, logs, and falls back to the TS config', () => {
    // Missing required `sql` / `columns` fields — fails
    // declarativeQueryConfigSchema validation inside loadDeclarativeConfig.
    DECLARATIVE_CATALOG[targetName] = {
      name: targetName,
    } as unknown as DeclarativeQueryConfig

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    let result: ReturnType<typeof getQueryConfigByName>
    expect(() => {
      result = getQueryConfigByName(targetName, DECLARATIVE_ENV)
    }).not.toThrow()

    expect(result).toBeDefined()
    expect(result).toBe(getQueryConfigByName(targetName, TS_ENV)) // same TS reference
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })
})
