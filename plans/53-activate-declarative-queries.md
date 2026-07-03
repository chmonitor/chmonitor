# 53 — Activate the declarative query-config path

## Current reality (audited)
The declarative engine is built but dormant: `apps/dashboard/src/lib/query-config/declarative/{schema,loader}.ts` are feature-complete, a parallel `declarative/catalog/` mirrors the hand-rolled configs, and `apps/dashboard/src/lib/query-config/index.ts` selects the source via `getConfigSource()` — which defaults to `ts`. Nothing exercises the declarative path in CI, so it can rot.

## Goal
Flip-ready declarative path: `CHM_CONFIG_SOURCE=declarative` routes all query lookups through the validated catalog, a parity test proves declarative ≡ TS for a representative set, and the env var is documented. TS remains the default.

## Implement now (depth F)
- Add `apps/dashboard/src/lib/query-config/__tests__/declarative-parity.test.ts`:
  - For ≥10 representative configs (running-queries, merges, replicas, disks, parts, errors, …), load both the TS config and its declarative equivalent and assert the resolved SQL (per supported CH version), columns, and formats match.
- Confirm `getConfigSource()` reads `CHM_CONFIG_SOURCE` (`ts` default) and that the loader validates + fails closed to defaults on a malformed entry (add a test for a deliberately-bad declarative config → falls back, logs, does not throw).
- Document the flag in `docs/` (deployment/config reference) and `apps/dashboard/.env.example`.
- Do NOT change the default; this plan makes the path trustworthy, not the default.

## STOP conditions & drift check
- STOP if the declarative catalog is materially out of sync with the TS catalog — record the gap and scope the parity test to the configs that exist on both sides (don't fabricate configs).
- Drift: confirm `getConfigSource()` and the catalog directory still exist and are named as above.

## Done criteria
- `CHM_CONFIG_SOURCE=declarative` routes all lookups through the catalog; TS remains default.
- Parity test covers ≥10 configs (SQL/columns/formats) and passes.
- A malformed declarative config fails closed to defaults (tested); flag documented.

---

## Audit notes (added during implementation, 2026-07-03)

Before implementing, the current codebase was audited against this plan's
"Current reality" section. Findings:

- **The declarative path is far more built-out than "dormant."** The catalog
  (`DECLARATIVE_CATALOG`) has 93 entries: 91 map to a same-named config in the
  107-entry TS `queries` registry, plus 2 catalog-only entries
  (`keeper-presence`, `cluster-live-metrics-all`) consumed by direct import.
  16 TS configs have no catalog entry (9 for a documented reason — inline-JSX
  expandables, the pending `panel` expandable variant, or runtime-templated
  SQL; 7 simply not yet migrated, no principled blocker). ~85% coverage is not
  materially out of sync (drift check passes; no STOP triggered). Extensive
  parity coverage already exists and passes: `declarative/loader.test.ts`,
  every `declarative/catalog/*/*-catalog.test.ts` domain suite,
  `declarative/catalog/flip-safety.test.ts` (all 93 entries, via the real
  `getQueryConfigByName` resolver, both env sources), and
  `query-config/getQueryConfigByName.test.ts` (all 107 TS names). This already
  exceeds the "≥10 representative configs" done-criterion.
- **`running-queries` is confirmed TS-only** (inline-JSX expandable, per
  `docs/knowledge/declarative-config-catalog.md`) — it has no declarative
  catalog equivalent. The plan's example representative list is swapped
  accordingly in the new parity test (see file), per the STOP condition's
  instruction to scope to configs present on both sides and record the gap.
- **The one genuine gap: the resolver did NOT fail closed.**
  `getQueryConfigByName` called `loadDeclarativeConfig(decl)` with no
  try/catch — a malformed catalog entry would throw out of the resolver
  instead of falling back to the TS default, violating the task's
  non-negotiable invariant ("fail-closed to defaults on a bad config, never
  crash the dashboard"). Fixed in this change (see `index.ts` diff) with a
  logged fallback, plus a new test that mutates a live catalog entry to a
  malformed shape and asserts no-throw + TS fallback + logged.
- **Docs gap: `CHM_CONFIG_SOURCE` was undocumented in the two "official
  reference" surfaces** (`apps/dashboard/.env.example` and
  `docs/content/reference/environment-variables.mdx`), despite being
  documented narratively in `docs/content/reference/catalog-contributing.mdx`
  and `docs/knowledge/declarative-config-catalog.md`. Closed in this change.
  `.env.example` documents the var as commented-out with default `ts` — it
  must never ship `declarative` as the self-hosted default.
