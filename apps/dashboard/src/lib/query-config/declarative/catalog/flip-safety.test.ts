/**
 * Catalog-wide flip-safety invariants for the declarative config catalog
 * (Plan 02L-prep).
 *
 * The per-domain `*-catalog.test.ts` files prove that each declarative config
 * round-trips to a QueryConfig that deep-equals its hand-written TS legacy on
 * the serializable fields. Those tests call `loadDeclarativeConfig` directly
 * and EXCLUDE runtime-only fields from comparison.
 *
 * This file adds the three guarantees that the per-domain tests structurally
 * cannot, and that the eventual `CHM_CONFIG_SOURCE=declarative` default flip
 * (Plan 02L) depends on:
 *
 *   1. RESOLVER PARITY — exercise the real runtime entry point,
 *      `getQueryConfigByName(name, env)`, under BOTH config sources and assert
 *      the declarative result deep-equals the TS result on every serializable
 *      field. The per-domain tests bypass the resolver.
 *
 *   2. NO SILENT DROP — flipping to `declarative` must not turn a
 *      behavior-bearing field that the TS config defines into `undefined`. The
 *      loader carries some such fields (`expandable` config-details variant,
 *      `rowClassName` via `rowStyle`, `permission`) but genuinely cannot
 *      represent others (`columnIcons`, `filterSchema`, `columnFilters`,
 *      inline-JSX `expandable`). Rather than hardcode which are dropped (a list
 *      that goes stale as the loader gains support — e.g. #1728 made the
 *      config-details `expandable` serializable), this asserts the invariant
 *      directly: every behavior field the TS-resolved config defines is still
 *      defined on the declarative-resolved config. A catalog entry whose TS
 *      original uses a field the loader drops fails loudly here.
 *
 *   3. ORPHAN GUARD — every catalog name must resolve to a TS config of the
 *      same name in the central `queries` registry, EXCEPT a small known
 *      allowlist of configs that are consumed by direct import (and so never go
 *      through the name-resolution flip path). A new, unexpected orphan fails
 *      the test, forcing a conscious decision rather than a silent gap.
 *
 * All assertions are pure object comparisons — no live ClickHouse, no network.
 */

import { describe, expect, test } from 'bun:test'
import { getQueryConfigByName, queries } from '@/lib/query-config'
import { DECLARATIVE_CATALOG } from '@/lib/query-config/declarative/catalog'
import { loadDeclarativeConfig } from '@/lib/query-config/declarative/loader'

// ---------------------------------------------------------------------------
// Config-source env overrides — `getConfigSource` reads runtimeEnv first, so
// passing these to `getQueryConfigByName` forces each source deterministically
// without mutating global env.
// ---------------------------------------------------------------------------

const TS_ENV = { CHM_CONFIG_SOURCE: 'ts' } as const
const DECLARATIVE_ENV = { CHM_CONFIG_SOURCE: 'declarative' } as const

// Serializable fields — the surface the declarative schema carries. Mirrors the
// SERIALIZABLE_KEYS list used by the per-domain catalog tests. Functions
// (rowClassName compiled from `rowStyle`) and `permission` are compared by the
// per-domain suites behaviorally; here we deep-equal the data-only surface.
const SERIALIZABLE_KEYS = [
  'name',
  'description',
  'docs',
  'suggestion',
  'sql',
  'columns',
  'columnFormats',
  'columnDescriptions',
  'columnSizing',
  'tableBehavior',
  'defaultParams',
  'filterParamPresets',
  'optional',
  'tableCheck',
  'disableSqlValidation',
  'refreshInterval',
  'relatedCharts',
  'card',
  'defaultView',
  'bulkActions',
  'bulkActionKey',
  'sortingFns',
  'clickhouseSettings',
] as const

// Behavior-bearing (non-serializable-surface) fields. The flip is safe only if
// every one of these the TS config defines is also defined after loading the
// declarative config — i.e. the flip never silently drops behavior. The loader
// carries expandable/rowClassName/permission; columnIcons/filterSchema/
// columnFilters it cannot, so a catalog entry whose TS original uses one of
// those would fail this check (correctly — it must stay a TS-only config).
const BEHAVIOR_FIELDS = [
  'expandable',
  'rowClassName',
  'permission',
  'columnIcons',
  'filterSchema',
  'columnFilters',
] as const

// Behavior fields a specific catalog config keeps TS-only ON PURPOSE because the
// declarative schema cannot express them — declared here so the drop is explicit,
// not silent (any UNLISTED drop still fails the check below). `query-metric-log`'s
// `expandable` is a bespoke, lazily-loaded React panel
// (createQueryMetricLogExpandedDetails); `compileExpandable` only supports the
// serialisable `config-details` variant, so the panel stays authoritative in the
// TS config while the mirror still validates the SQL/columns surface.
const TS_ONLY_BEHAVIOR: Record<string, ReadonlySet<string>> = {
  'query-metric-log': new Set(['expandable']),
}

// Catalog names with NO config of the same name in the central `queries`
// registry. Both are real TS configs (`keeperPresenceConfig`,
// `clusterLiveMetricsAllConfig`) consumed by DIRECT IMPORT in
// routes/api/v1/cluster-topology.ts — they are passed as `queryConfig:` and
// never resolved by name, so the config-source flip cannot affect them. They
// are catalog-only on purpose; this allowlist documents that.
const DIRECT_IMPORT_ONLY = new Set<string>([
  'keeper-presence',
  'cluster-live-metrics-all',
])

// Boolean fields that default to `false` when omitted. Some declarative
// configs set them explicitly (`optional: false`) where the TS original omits
// them; that is behaviorally identical. Normalizing both sides to the effective
// boolean keeps the comparison bidirectional (a real `optional: true` mismatch
// still fails) without flagging the redundant-but-harmless explicit default.
const BOOLEAN_DEFAULT_FALSE_KEYS = ['optional', 'disableSqlValidation'] as const

function pickSerializable(
  config: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of SERIALIZABLE_KEYS) {
    if (key in config) result[key] = config[key]
  }
  for (const key of BOOLEAN_DEFAULT_FALSE_KEYS) {
    result[key] = Boolean(result[key])
  }
  return result
}

const catalogNames = Object.keys(DECLARATIVE_CATALOG).sort()
const tsConfigsByName = new Map(
  queries.map((q) => [q.name, q as unknown as Record<string, unknown>])
)

describe('declarative catalog — flip-safety invariants', () => {
  test('catalog is non-empty (guards against a broken assembly)', () => {
    expect(catalogNames.length).toBeGreaterThan(0)
  })

  test('every catalog entry loads without throwing', () => {
    for (const name of catalogNames) {
      expect(() =>
        loadDeclarativeConfig(DECLARATIVE_CATALOG[name])
      ).not.toThrow()
    }
  })

  test('orphan guard: catalog names map to a TS config except the known direct-import allowlist', () => {
    const orphans = catalogNames.filter(
      (name) => !tsConfigsByName.has(name) && !DIRECT_IMPORT_ONLY.has(name)
    )
    expect(orphans).toEqual([])

    // The allowlist must stay accurate: every listed name is genuinely absent
    // from `queries` (else it is stale and should be pruned).
    for (const name of DIRECT_IMPORT_ONLY) {
      expect(tsConfigsByName.has(name)).toBe(false)
    }
  })

  // Per-entry assertions for every catalog config that the flip actually
  // affects (i.e. resolved by name through getQueryConfigByName).
  for (const name of catalogNames) {
    if (DIRECT_IMPORT_ONLY.has(name)) continue
    const ts = tsConfigsByName.get(name)
    if (!ts) continue // covered by the orphan-guard test above

    describe(name, () => {
      const tsResolved = getQueryConfigByName(
        name,
        TS_ENV
      ) as unknown as Record<string, unknown>
      const declResolved = getQueryConfigByName(
        name,
        DECLARATIVE_ENV
      ) as unknown as Record<string, unknown>

      test('both config sources resolve the config', () => {
        expect(tsResolved).toBeDefined()
        expect(declResolved).toBeDefined()
      })

      test('flip preserves every behavior field the TS config defines', () => {
        const dropped = BEHAVIOR_FIELDS.filter(
          (field) =>
            tsResolved[field] !== undefined &&
            declResolved[field] === undefined &&
            !TS_ONLY_BEHAVIOR[name]?.has(field)
        )
        expect(dropped).toEqual([])
      })

      test('declarative resolver result deep-equals TS resolver result (serializable surface)', () => {
        expect(pickSerializable(declResolved)).toEqual(
          pickSerializable(tsResolved)
        )
      })
    })
  }
})
