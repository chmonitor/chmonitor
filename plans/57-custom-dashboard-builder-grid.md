# 57 — Custom dashboard builder (drag-drop grid)

## Kickoff prompt

```text
Execute plans/57-custom-dashboard-builder-grid.md ALONE. Build a drag-drop dashboard grid with
widget types (chart/table/stat/text) and a single shared time-range, persisted via plan 56.
Invariants: self-hosted stays whole (works without D1 via localStorage); honest paywalls
(custom-dashboard limits per plan, advertised⟺enforced or deferred); Postgres=NO for 2026 H2.
Read the plan fully, honor STOP conditions, then run every Verification command and update your row
in plans/README.md.
Verify: cd apps/dashboard && bun run type-check && bun run build; bun test src/components/dashboard --isolate; bun run lint.
```

## Current reality (audited)

`apps/dashboard/src/routes/(dashboard)/dashboard.tsx` supports selecting from built-in charts and
saving a set, but the PRD's dynamic-dashboard vision (drag-drop grid, widget types, shared
time-range) is only partial. `@dnd-kit` is already a dependency.

## Goal

Users add/move/resize widgets on a grid; all widgets share one time-range; layouts save/load via
plan 56. Widget types: chart (from the registry), table, single-stat, text/markdown.

## Implement now (depth E — resolve open questions during discovery)

- New `apps/dashboard/src/components/dashboard/{grid.tsx, widget-frame.tsx, widget-chart.tsx,
  widget-stat.tsx, widget-table.tsx, widget-text.tsx}` using `@dnd-kit` for drag/resize.
- A shared `TimeRangeContext` that all widgets consume (single control drives every widget).
- Layout model `{ widgets: [{id, type, chartName?, x, y, w, h, props}] }`; persist via plan 56
  (D1 + localStorage fallback).
- Integrate into `dashboard.tsx` (edit mode toggle: view ⇄ arrange).
- Enforce custom-dashboard count per plan via `plan-enforcement` (or classify `deferred`).
- Tests: layout serialize/deserialize round-trip; time-range change propagates to all widgets.
- **Open questions:** grid lib specifics (dnd-kit sortable vs. a grid layout helper), responsive
  breakpoints, chart-widget data wiring to existing chart components.

## STOP conditions & drift check

- STOP if plan 56 isn't merged — the builder needs its persistence; until then, localStorage-only.
- STOP before adding a hard paywall in free beta — classify the limit explicitly.
- Drift: confirm the chart registry API used to instantiate chart widgets.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/components/dashboard --isolate
bun run lint
```

## Done criteria

- Add/move/resize widgets of all four types; one shared time-range drives all.
- Layout persists + reloads via plan 56 (D1 or localStorage).
- Custom-dashboard limit classified in `plan-enforcement`.

Priority: P1 · Effort: L · Depth: E · Wave: D (Dashboards) · Lever: Adoption / Revenue · Depends on: 56
