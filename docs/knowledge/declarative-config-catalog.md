---
id: declarative-config-catalog
title: Declarative Config Catalog
type: spec
status: active
updated: 2026-07-03
tags:
  - query-config
  - declarative
  - catalog
  - platform
related:
  - query-config-format
  - static-site-architecture
  - table-availability
---

# Declarative Config Catalog

The **declarative config catalog** is the serializable subset of `QueryConfig`
expressed as plain data — objects that contain no JSX, no functions, and no
component imports. It is the foundation for letting the community contribute
monitoring checks without writing TypeScript, and it lives alongside the legacy
TS query configs behind a flag.

> This documents the *subsystem and contract*. For the per-field authoring
> reference (the contributor-facing guide), see
> `docs/content/reference/catalog-contributing.mdx`. For the in-memory
> `QueryConfig` type itself, see [[query-config-format]].

## Where it lives

```
apps/dashboard/src/lib/query-config/declarative/
├── schema.ts        # Zod schema — the catalog contract (DeclarativeQueryConfig)
├── validate.ts      # validateDeclarativeConfig() — safe parse → {ok, config|errors}
├── loader.ts        # loadDeclarativeConfig() → in-memory QueryConfig; getConfigSource()
├── row-style.ts     # compileRowStyle() — compiles rowStyle rules → RowClassNameFn
└── catalog/
    ├── index.ts     # DECLARATIVE_CATALOG: Record<name, DeclarativeQueryConfig>
    └── <domain>/*.ts # one file per migrated config, grouped by domain
```

## The flag (opt-in)

Resolution is gated by `CHM_CONFIG_SOURCE` (server runtime env, falling back to
the build-time `VITE_CONFIG_SOURCE`). Anything other than the literal string
`declarative` resolves to `ts` — **the default is `ts`**, i.e. the catalog is
inert until explicitly turned on. `getQueryConfigByName(name, env)` in
`lib/query-config/index.ts` is the central resolver: when the source is
`declarative` it serves `DECLARATIVE_CATALOG[name]` (falling back to the TS
config when a name is absent from the catalog); when `ts` it returns the TS
config unchanged (by reference).

**Fail-closed on a malformed entry.** A second, distinct fallback path exists
for a name that IS present in the catalog but fails `loadDeclarativeConfig`'s
schema validation (a hand-authoring bug): the resolver catches the error, logs
it via `@chm/logger`'s `error()`, and falls through to the TS config for that
name — it never lets a bad catalog entry throw out of `getQueryConfigByName`
and crash the dashboard. Every shipped catalog entry already passes validation
(enforced by `flip-safety.test.ts`'s "every catalog entry loads without
throwing"), so this path only fires for a future authoring mistake; it is
tested directly in `getQueryConfigByName.test.ts` by mutating a live catalog
entry to an invalid shape.

The full default-flip to `declarative` is
**deferred** (plan 02L) — it changes prod rendering for ~75 views and needs
route-level visual verification against a live ClickHouse, which is not yet
available.

## Pipeline

```
DeclarativeQueryConfig (data)
  → validateDeclarativeConfig (Zod)   # throws/returns errors on bad input
  → loadDeclarativeConfig             # maps serializable fields 1:1 to QueryConfig
  → QueryConfig (in-memory)           # consumed by the data-table + charts
```

The mapping is 1:1 by design — field names and value shapes are shared. Two
fields are *derived* rather than copied: `rowStyle` is compiled into a
`rowClassName` function, and `permission` is carried through as plain data.

## What the schema can express

The serializable contract (`declarativeQueryConfigSchema`) carries: `name`,
`sql` (string or `VersionedSql[]` with `since`), `columns`, `columnFormats`,
`columnDescriptions`, `columnSizing`, `tableBehavior`, `defaultParams`,
`filterParamPresets` (icon omitted), `optional`, `tableCheck`,
`disableSqlValidation`, `refreshInterval`, `relatedCharts`, `card`,
`defaultView`, `bulkActions`/`bulkActionKey`, `description`, `suggestion`,
`docs`, plus these incrementally-added fields:

| Field | Added for | Notes |
|---|---|---|
| `sortingFns` | sort by underlying value | enum incl. `sort_column_using_actual_value` |
| `clickhouseSettings` | per-query execution settings | `Record<string, string\|number\|boolean>` |
| `docs` | table-missing help text | loosened from `.url()` to plain `string` |
| `rowStyle` | conditional row classes | ordered `{ when, className }` rules → compiled to `rowClassName` |
| `permission` | feature gating | plain `{ feature, defaultAccess?, operation? }` (enum mirrored from `lib/feature-permissions/types.ts`, not imported) |

### rowStyle (the rowClassName replacement)

`rowStyle.rules` is an ordered list; the first matching rule's `className`
wins, else `default`. Condition operators — `gt`/`gte`/`lt`/`lte` (numeric),
`truthy`/`falsy` (numeric truthiness), `empty`/`nonempty` (string), and
`all`/`any` combinators — and their coercion (`Number(v || 0)` /
`String(v || '')`) mirror the legacy `rowClassName` idioms **exactly**, so a
compiled function is behaviourally identical to the TS function it replaced.

## expandable — partially serializable (#1728)

`expandable` renders a per-row detail panel. Its two stable factory shapes are
data-describable, so a serializable spec carries them and the loader compiles
each back into an `ExpandableConfig` via `compileExpandable`. The schema uses a
discriminated union on `type` so variants can land incrementally:

- **`config-details`** (`createConfigExpandedDetails({ primaryColumns, descriptionKey })`)
  — **done** (#1728). An auto-grid of every row column not already in
  `primaryColumns`. `settings` and `users` are migrated using it.
- **`panel`** (`createExpandedPanel({ sections })`) — **follow-up**; room is
  reserved in the union but not yet implemented. Unblocks the remaining query
  configs (`expensive`/`slow`/`failed`/`history`).
- **inline-JSX expandables** (bespoke React per row — `running-queries`,
  `keeper-connections`, `readonly-tables`) — genuinely **not** serializable,
  stay TS-only.

## What stays TS-only (and why)

These fields are intentionally **excluded** from the schema because they require
runtime code, not data:

- **`columnIcons`** — React component refs (blocks `expensive-queries`).
- **`filterSchema`** / **`columnFilters`** — contain `Icon` refs and dynamic
  option functions.
- Runtime-templated SQL — e.g. `more/page-views` interpolates the runtime
  `EVENTS_TABLE` env var into its SQL, which cannot be inlined as data.

## Testing

Each domain has a `<domain>-catalog.test.ts` snapshot suite that runs
`loadDeclarativeConfig(decl)` and **deep-equals** the result against the legacy
TS config on every serializable field (runtime-only fields are excluded from the
comparison). `getQueryConfigByName.test.ts` additionally asserts declarative↔TS
parity across the whole catalog. Two verification shapes:

- **Data fields** (most) → deep-equal snapshot. Inlined values (e.g. `docs`
  strings copied from `lib/table-notes`, or `query-detail`'s `baseSelect` SQL)
  are byte-matched against the legacy source.
- **`rowStyle`** → compiles to a function, which can't be deep-equaled, so it is
  verified **behaviourally**: both the compiled and legacy `rowClassName` are
  applied to rows covering every condition boundary and asserted identical.
  `row-style.test.ts` separately pins each operator's semantics.

`DECLARATIVE_CATALOG` (catalog/index.ts) also asserts unique `name`s at module
load and throws on a duplicate.

**Flip-safety invariants** (`catalog/flip-safety.test.ts`, #1729) enforce
catalog-wide what the per-domain suites can't, gating the 02L default flip:

- **Resolver parity** — `getQueryConfigByName(name, env)` under both
  `CHM_CONFIG_SOURCE` values deep-equals on the serializable surface (default
  `false` booleans normalized, so explicit `optional: false` ≡ omitted).
- **No silent drop** — for every behavior field (`expandable`/`rowClassName`/
  `permission`/`columnIcons`/`filterSchema`/`columnFilters`), a value the
  TS-resolved config defines must remain defined after loading the declarative
  one. Self-adjusting: as the loader gains support (e.g. #1728's `expandable`),
  the check follows without a hardcoded drop-list.
- **Orphan guard** — every catalog name maps to a same-named TS config, except a
  documented allowlist (`keeper-presence`, `cluster-live-metrics-all`) consumed
  by direct import in `routes/api/v1/cluster-topology.ts`.

## Community query packs (plan 54)

`declarative/pack-registry.ts` lets self-hosters extend the catalog at runtime
without rebuilding, via `CHM_PACK_REGISTRY_URL` (comma-separated HTTP(S) or
`file://` URLs), consulted when `CHM_CONFIG_SOURCE=declarative`. Each pack is
one YAML manifest — `{ name, version, minChmVersion?, queries: [...] }` — where
every entry in `queries` is validated against the same
`declarativeQueryConfigSchema` as the built-in catalog.

- **`loadPacks(urls, fetchImpl?)`** — the directly-testable core (mirrors
  `local-loader.ts`'s `loadLocalConfigs`): fetches each URL (SSRF-guarded via
  `createHostValidationFetch`, with a 5s timeout; `file://` reads the local
  path directly — not a network concern, same trust model as
  `CHM_CONFIG_DIRECTORY`), parses YAML, validates the manifest shape, then
  validates each query individually. A whole pack is rejected (fetch error,
  invalid YAML, invalid manifest) on failure; a single bad query inside an
  otherwise-valid pack is skipped without dropping its siblings. Every failure
  is `warn`-logged and returned in `skipped` — this function never throws.
- **Precedence**: local `queries.d` (plan 55) > packs > built-in
  `DECLARATIVE_CATALOG` > TS `queries`. Within packs, a later
  `CHM_PACK_REGISTRY_URL` entry wins on a name collision (logged).
- **Startup-only (v1)** — `ensurePacksLoaded(runtimeEnv)` is memoized for the
  process lifetime; no hot-reload. The two `tables/$name` route handlers
  (`browser-connections`, `user-connections`) `await` it before the
  synchronous `getQueryConfigByName` lookup so a pack-only query resolves
  deterministically on first request, instead of racing a background fetch.
- **`minChmVersion`** is schema-validated but not yet enforced against the
  running app version — deferred, same as pack signing/verification.

## Status

Foundation + opt-in wiring complete; `DECLARATIVE_CATALOG` has 93 entries — 91
map to a same-named config in the 107-entry TS `queries` registry, plus 2
catalog-only entries (`keeper-presence`, `cluster-live-metrics-all`) consumed
by direct import (see orphan guard above) — across all 10 domains, including
`settings`/`users` via the `config-details` expandable (#1728), all dormant
behind `CHM_CONFIG_SOURCE=ts`. Of the 16 TS configs with no catalog entry: 3
are inline-JSX expandables (`running-queries`, `keeper-connections`,
`readonly-tables`), 5 are blocked on the not-yet-implemented `panel` expandable
variant (`expensive-queries`, `expensive-queries-by-memory`, `slow-queries`,
`failed-queries`, `history-queries`), 1 has runtime-templated SQL
(`page-views`) — see "What stays TS-only" above — and the remaining 7
(`explorer-table-overview`, `explorer-table-usage`, `warnings`,
`blob-storage-log`, `storage-compression`, `storage-policies`,
`ttl-storage-moves`) simply haven't been migrated yet; there is no principled
blocker recorded for them. The catalog is bundled (imported by the registry) but
tree-shaken from rendering paths until the flag flips. Adding a check is a
single-file PR — see the contributor guide. There are no external catalog
consumers yet, so the `rowStyle`, `permission`, and `expandable` contracts
remain freely revisable until the 02L default-flip — whose safety is now
machine-enforced by the flip-safety invariants above, plus a representative
`__tests__/declarative-parity.test.ts` sample that additionally cross-checks
`selectVersionedSql`-resolved SQL per ClickHouse version (plan 53).
