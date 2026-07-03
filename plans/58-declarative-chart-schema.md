# 58 — Declarative chart schema

## Kickoff prompt

```text
Execute plans/58-declarative-chart-schema.md ALONE. Define a declarative schema + loader for chart
configs (mirroring the query-config declarative system) and port ~5 factory charts as templates,
so charts can be authored as data (and later by the community/AI).
Invariants: self-hosted stays whole; hand-rolled charts keep working (additive, no regression);
Postgres=NO for 2026 H2. Read the plan fully, honor STOP conditions, then run every Verification
command and update your row in plans/README.md.
Verify: cd apps/dashboard && bun run type-check && bun run build; bun test src/components/charts --isolate; bun run lint.
```

## Current reality (audited)

Charts are TypeScript: ~40 use the factory (`apps/dashboard/src/components/charts/factory/`), ~34
are hand-rolled, and there is **no serializable chart schema**. Adding a chart requires code; the
community/AI can't author visualizations without forking. The query-config declarative system
(plans 53–54) is the model to mirror.

## Goal

A declarative chart schema + loader that maps a serializable chart definition to a `ChartFactory`
call, with ≥5 factory charts ported as templates and identical rendering.

## Implement now (depth E — resolve open questions during discovery)

- New `apps/dashboard/src/components/charts/declarative/{schema.ts, loader.ts, catalog.ts}`
  mirroring `lib/query-config/declarative/`.
- Extract serializable fields from factory charts (chartName, index/query ref, categories,
  defaultInterval, series/axis config); resolve `Icon` refs via lazy imports.
- `loader` maps a declarative chart → existing `ChartFactory` call.
- Port ≥5 factory charts (e.g. query-count, disk-size, memory-usage, merges, parts) into the
  declarative catalog as templates; snapshot/visual-parity test vs the TS versions.
- Document the authoring format for community contributions.
- **Open questions:** how much interactivity is expressible declaratively (keep bespoke charts in
  TS), icon resolution strategy, whether declarative charts join the chart registry directly.

## STOP conditions & drift check

- STOP if the factory API changed — align the loader to the current factory signature.
- Keep hand-rolled charts untouched; this is additive.
- Drift: confirm the chart registry + factory paths.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/components/charts --isolate
bun run lint
```

## Done criteria

- ≥5 charts render identically from declarative definitions.
- Schema + loader mirror the query-config declarative system; authoring documented.
- Hand-rolled and factory charts unaffected.

Priority: P2 · Effort: M · Depth: E · Wave: D (Dashboards) · Lever: OSS-extensibility / AI · Depends on: 53
