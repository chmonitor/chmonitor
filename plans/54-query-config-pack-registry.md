# 54 — Community query-pack registry

## Kickoff prompt

```text
Execute plans/54-query-config-pack-registry.md ALONE. Add a pack loader that fetches, validates,
and merges community-authored YAML query packs into the declarative catalog, so self-hosters ship
new queries without rebuilding. Depends on the declarative path (plan 53).
Invariants: self-hosted stays whole; TS config path stays default; a malformed/unreachable pack
must fail-closed to the built-in catalog (never crash); SSRF-guard the pack fetch; Postgres=NO for
2026 H2. Read the plan fully, honor STOP conditions, then run every Verification command and update
your row in plans/README.md.
Verify: cd apps/dashboard && bun run type-check && bun run build; bun test src/lib/query-config --isolate; bun run lint.
```

## Current reality (audited)

The declarative loader (`apps/dashboard/src/lib/query-config/declarative/loader.ts`) can compile a
serializable config, but there is **no mechanism to load external packs** — the catalog is
compiled-in. Self-hosters must fork to add queries. (Depends on plan 53 making the declarative path
trustworthy.)

## Goal

`CHM_PACK_REGISTRY_URL` (HTTP or `file://`) points at one or more query packs; at startup they are
fetched, validated against the declarative schema, and merged into the catalog. Bad packs are
rejected with a clear error and the built-in catalog still serves.

## Implement now (depth E — resolve open questions during discovery)

- New `apps/dashboard/src/lib/query-config/declarative/pack-registry.ts`:
  - Pack manifest schema `{ name, version, minChmVersion?, queries: DeclarativeQueryConfig[] }`.
  - `loadPacks(urls)` — fetch (SSRF-guarded via the existing host-validation fetch), parse YAML,
    validate each query with the declarative schema, dedupe by name, merge into the catalog.
  - Cache with a version key; graceful degradation + structured logging on any failure.
- Extend `loader.ts`/`index.ts` to consult loaded packs when `CHM_CONFIG_SOURCE=declarative`.
- Env: `CHM_PACK_REGISTRY_URL` (comma-separated); document precedence (built-in < pack; last pack
  wins on name collision, logged).
- Tests: valid pack merges + appears in lookup; malformed pack is rejected and built-ins still
  resolve; `file://` local pack loads.
- **Open questions:** signature/verification of packs (defer or add a checksum), hot-reload vs.
  startup-only (startup-only for v1), namespacing collisions.

## STOP conditions & drift check

- STOP if plan 53's declarative path isn't merged/trustworthy — land 53 first.
- STOP before adding any un-guarded outbound fetch; reuse the SSRF-guarded fetch primitive.
- Drift: confirm the declarative schema export used for validation.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/query-config --isolate
bun run lint
```

## Done criteria

- A pack from an HTTP URL and a `file://` mount both load and appear in query lookups.
- A malformed/unreachable pack fails closed to the built-in catalog (tested).
- Pack fetch is SSRF-guarded; precedence + collisions documented.

Priority: P0 · Effort: M · Depth: E · Wave: D (Dashboards/OSS) · Lever: OSS-extensibility / Adoption · Depends on: 53
