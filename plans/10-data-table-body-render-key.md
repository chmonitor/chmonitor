# Plan 10: Stop serializing the full table state on every DataTable render

> **Executor instructions**: Follow step by step; verify each step. On a "STOP
> condition", stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/components/data-table/data-table.tsx`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

`DataTable` computes its memo-busting key by `JSON.stringify`-ing **nine** state objects on
**every render** (`data-table.tsx:562-573`), including the `rowSelection` and `expanded` maps
that grow with the number of selected/expanded rows. Because `columnResizeMode` defaults to
`'onChange'` (`resolve-table-behavior.ts:37`), a column-resize drag re-renders on **every
mousemove**, re-stringifying the entire state graph each frame. This is the same class of
hot-path serialization that was removed from the ClickHouse client in #2194, now on the
client render path. The fix replaces the whole-object `JSON.stringify` with a pure helper
that builds a cheap key from primitives — preserving the exact memo-busting contract (the
existing comment enumerates what must bust the memo) while avoiding the per-frame
serialization.

## Current state

File: `apps/dashboard/src/components/data-table/data-table.tsx`. The key (`:556-573`):

```tsx
// … DataTable re-renders on every controlled state change (sorting, expanded,
// columnSizing, rowSelection, ...) whereas DataTableContent's props are otherwise
// stable — so a state change like `expanded` would never reach the memo and row
// expansion would silently no-op. Passing this down guarantees the body memo busts
// when rows change.
const tableState = table.getState()
const bodyRenderKey = JSON.stringify([
  tableState.sorting, tableState.pagination, tableState.expanded,
  tableState.columnSizing, tableState.columnOrder, tableState.columnVisibility,
  tableState.rowSelection, globalSearch, advancedFilters,
])
```

`bodyRenderKey` is passed to the memoized `<DataTableContent … />` (`:685`) to bust its memo.
The **contract**: the key MUST change whenever any of those 9 values changes, or the body
goes stale (the comment's "silently no-op" warning). `columnResizeMode` comes from
`resolve-table-behavior.ts:37` (`behavior.columnResizeMode ?? 'onChange'`).

Conventions: TanStack Table types (`SortingState`, `PaginationState`, `ExpandedState`,
`ColumnSizingState`, `ColumnOrderState`, `VisibilityState`, `RowSelectionState`) come from
`@tanstack/react-table`. Tests are **Bun test**. Data-table has no existing unit test, so the
new helper's test is the machine-checkable gate for the busting contract.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Run helper test | `cd apps/dashboard && bun test src/components/data-table/utils/body-render-key.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |
| Grep old key gone | `rg -n "JSON.stringify\(\[" apps/dashboard/src/components/data-table/data-table.tsx` | no matches after fix |

## Scope

**In scope**:
- `apps/dashboard/src/components/data-table/utils/body-render-key.ts` (create — pure helper)
- `apps/dashboard/src/components/data-table/utils/body-render-key.test.ts` (create — unit test)
- `apps/dashboard/src/components/data-table/data-table.tsx` (wire the helper in; optional memo split)

**Out of scope**:
- `resolve-table-behavior.ts` / `columnResizeMode` default — do NOT change resize UX to `'onEnd'` (that would remove the live-resize feature).
- `DataTableContent` and its memo comparator.
- Any other data-table behaviour.

## Git workflow

- Branch: `advisor/10-data-table-body-render-key`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `perf(data-table): build body render key from primitives instead of JSON.stringify`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Create the pure helper

`body-render-key.ts` exports `computeTableBodyRenderKey(input)` taking the 9 values and
returning a string that changes iff any input changes, without JSON-serializing whole objects:

```ts
import type {
  ColumnOrderState, ColumnSizingState, ExpandedState, PaginationState,
  RowSelectionState, SortingState, VisibilityState,
} from '@tanstack/react-table'

export function computeTableBodyRenderKey(input: {
  sorting: SortingState; pagination: PaginationState; expanded: ExpandedState
  columnSizing: ColumnSizingState; columnOrder: ColumnOrderState
  columnVisibility: VisibilityState; rowSelection: RowSelectionState
  globalSearch: string; advancedFilters: unknown
}): string {
  const { sorting, pagination, expanded, columnSizing, columnOrder, columnVisibility, rowSelection, globalSearch, advancedFilters } = input
  const sort = sorting.map((s) => `${s.id}:${s.desc ? 1 : 0}`).join(',')
  const page = `${pagination.pageIndex}:${pagination.pageSize}`
  const exp = expanded === true ? 'all' : Object.keys(expanded).sort().map((k) => `${k}:${(expanded as Record<string, boolean>)[k] ? 1 : 0}`).join(',')
  const sizing = Object.keys(columnSizing).sort().map((k) => `${k}:${columnSizing[k]}`).join(',')
  const order = columnOrder.join(',')
  const vis = Object.keys(columnVisibility).sort().map((k) => `${k}:${columnVisibility[k] ? 1 : 0}`).join(',')
  const sel = Object.keys(rowSelection).sort().map((k) => `${k}:${rowSelection[k] ? 1 : 0}`).join(',')
  // advancedFilters is small app-defined config; JSON is fine and safe here.
  return [sort, page, exp, sizing, order, vis, sel, globalSearch, JSON.stringify(advancedFilters)].join('|')
}
```

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0.

### Step 2: Unit-test the busting contract (this is the machine-checkable gate)

In `body-render-key.test.ts`, assert with a `base` input that the key **differs** after each
mutation and is **identical** for equal inputs:
- identical inputs → identical key;
- change sort direction / add a sort → differs;
- change `pagination.pageIndex` and `pageSize` → differs;
- expand a row (add a key to `expanded`) → differs; `expanded: true` differs from `{}`;
- resize a column (change a `columnSizing` value) → differs;
- reorder columns / toggle visibility → differs;
- select a row (add to `rowSelection`) / deselect a different one at same count → differs;
- change `globalSearch` / `advancedFilters` → differs.

**Verify**: `cd apps/dashboard && bun test src/components/data-table/utils/body-render-key.test.ts --isolate` → all pass.

### Step 3: Wire it into DataTable

Replace the `JSON.stringify([...])` at `data-table.tsx:562-573` with:

```tsx
const tableState = table.getState()
const bodyRenderKey = computeTableBodyRenderKey({
  sorting: tableState.sorting, pagination: tableState.pagination, expanded: tableState.expanded,
  columnSizing: tableState.columnSizing, columnOrder: tableState.columnOrder,
  columnVisibility: tableState.columnVisibility, rowSelection: tableState.rowSelection,
  globalSearch, advancedFilters,
})
```

**Verify**: `rg -n "JSON.stringify\(\[" apps/dashboard/src/components/data-table/data-table.tsx` → no matches; `cd apps/dashboard && bun run build` → exit 0.

### Step 4 (OPTIONAL — only if confident): memoize the resize-stable part

To make column resize (the per-mousemove case) cheapest, split the key so the parts that do
NOT change during a resize are memoized and only the sizing term recomputes per frame:

```tsx
const stableKey = useMemo(() => computeTableBodyRenderKey({
  sorting: tableState.sorting, pagination: tableState.pagination, expanded: tableState.expanded,
  columnSizing: {}, columnOrder: tableState.columnOrder, columnVisibility: tableState.columnVisibility,
  rowSelection: tableState.rowSelection, globalSearch, advancedFilters,
}), [tableState.sorting, tableState.pagination, tableState.expanded, tableState.columnOrder, tableState.columnVisibility, tableState.rowSelection, globalSearch, advancedFilters])
const sizingKey = useMemo(() => Object.keys(tableState.columnSizing).sort().map((k) => `${k}:${tableState.columnSizing[k]}`).join(','), [tableState.columnSizing])
const bodyRenderKey = `${stableKey}|${sizingKey}`
```

Only do this if you can confirm (via the manual checklist) that every interaction still
updates the body. If unsure, SKIP Step 4 — Step 3 alone is a valid, safe win.

**Verify**: `cd apps/dashboard && bun run build` → exit 0.

### Step 5: Manual interaction check (required — no unit test covers the wiring)

Run `cd apps/dashboard && bun run dev`, open a data-heavy table (e.g. a query history page),
and confirm the body updates correctly for each: **sort** a column, **change page** &
**page size**, **expand** a row, **select** rows (and select-all), **resize** a column,
**search**, and apply an **advanced filter**. The body must reflect each change (no stale
rows). Record the result in the PR description.

## Test plan

- New `body-render-key.test.ts` covering the busting contract (Step 2) — machine-checkable.
- Manual interaction checklist (Step 5) for the wiring — documented, not automated.
- Verification: `cd apps/dashboard && bun test src/components/data-table --isolate` → all pass.

## Done criteria

- [ ] `rg -n "JSON.stringify\(\[" apps/dashboard/src/components/data-table/data-table.tsx` → no matches
- [ ] `body-render-key.ts` + its test exist; `cd apps/dashboard && bun test src/components/data-table/utils/body-render-key.test.ts --isolate` passes
- [ ] `cd apps/dashboard && bun run type-check` and `bun run build` exit 0; `bun run lint` exits 0
- [ ] Manual interaction checklist (Step 5) completed and recorded
- [ ] `plans/README.md` status row updated

## STOP conditions

- The `bodyRenderKey` code doesn't match the excerpt (drift), or the key is consumed
  somewhere other than the `DataTableContent` memo.
- Any manual interaction (Step 5) shows a stale body after the change — revert to the
  original `JSON.stringify` key and report; a correct-but-slow key beats a fast-but-stale one.

## Maintenance notes

- Reviewer: verify the helper's key changes for every one of the 9 inputs (the unit test
  encodes this) and exercise column resize + row selection together in the running app.
- If a new controlled state is added to the table (e.g. grouping), it must be added to BOTH
  the helper input and its test, or the body will go stale for that dimension.
