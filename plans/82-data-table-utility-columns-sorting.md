# Plan 82: Centralize data-table utility column ids + fix null-blind numeric sorting

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/components/data-table`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (tables)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2499

## Why this matters

The three synthetic column ids (`__expand`, `select`, `action`) are re-listed
inline in at least four places, and one copy omits `'action'` — so the
row-action column participates in drag-to-reorder (`SortableContext`) unlike
its pinned siblings. Separately, the shared numeric sorting function returns
`0` for any non-number pair, so numeric columns containing `null`s (common with
optional ClickHouse columns) sort unpredictably.

## Current state

- `components/data-table/components/mobile-table-cards.tsx:57` —
  `Set(['select','action',EXPAND_COLUMN_ID])`
- `components/data-table/components/data-table-header.tsx:148` —
  filters `!['__expand','select','action']`
- `components/data-table/components/data-table-content.tsx:180-184` —

```ts
const columnIds = table
  .getAllLeafColumns()
  .map((col) => col.id)
  .filter((id) => id !== EXPAND_COLUMN_ID && id !== 'select')   // ← no 'action'
```

- `components/data-table/sorting-fns.ts:15-28` —

```ts
const colName = columnId.replace('readable_', '').replace('pct_', '')
const valueA = rowA.original[colName as keyof TData]
const valueB = rowB.original[colName as keyof TData]
if (typeof valueA === 'number' && typeof valueB === 'number') {
  return valueA - valueB
}
return 0    // ← nulls/strings compare equal to everything
```

`EXPAND_COLUMN_ID` is defined in the column-defs module (grep
`EXPAND_COLUMN_ID` under `components/data-table` for the source file) — put the
shared set next to it. Root CLAUDE.md documents these ids as "synthetic utility
column ids; treat them as non-data columns".

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/components/data-table` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: the four files above + the column-defs module (export
`UTILITY_COLUMN_IDS`), `sorting-fns.ts`, tests.

**Out of scope**: pagination/filter logic; DnD behaviour beyond excluding
`action`; renderer components.

## Git workflow

- Branch: `advisor/82-data-table-utility-columns-sorting`
- Commit: `fix(data-table): centralize utility column ids, order nullish values in numeric sort`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Export `UTILITY_COLUMN_IDS`
Next to `EXPAND_COLUMN_ID`: `export const UTILITY_COLUMN_IDS: ReadonlySet<string> = new Set([EXPAND_COLUMN_ID, 'select', 'action'])`.
Replace all four inline lists with it (content filter becomes
`.filter((id) => !UTILITY_COLUMN_IDS.has(id))` — this also fixes the missing
`'action'`).
**Verify**: `rg -n "'select'" apps/dashboard/src/components/data-table | rg -v UTILITY_COLUMN_IDS|column-defs` → no remaining inline lists (allow the definition site).

### Step 2: Fix the sorting fn
Coerce with `Number()`; order valid numbers normally; push NaN/nullish
consistently last (both directions — TanStack Table inverts the comparator for
desc, so use the `sortUndefined` option if the table already configures it, else
return a large sentinel consistently; read how other sorting fns in this file
handle it first and match).
**Verify**: unit test in Step 3 passes.

### Step 3: Tests
`sorting-fns.test.ts`: numbers sort; `null` vs number → null after; string
numeric `"5"` vs `3` → coerced ordering; two nulls → 0. Plus a small test that
`UTILITY_COLUMN_IDS` contains exactly the three ids.
**Verify**: `bun test src/components/data-table` → all pass.

## Done criteria

- [ ] Single source of truth for utility ids; `action` excluded from SortableContext
- [ ] Nullable numeric columns sort deterministically (tested)
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- Excluding `action` from `columnIds` breaks column-drag tests that encoded the
  buggy behaviour — update those tests only if their intent was clearly the
  bug; otherwise report.
- The blind `readable_`/`pct_` prefix strip is load-bearing for a data column
  actually named `readable_*` — if you find one in the configs, report it (do
  not change the strip in this plan).

## Maintenance notes

- New synthetic columns must be added to `UTILITY_COLUMN_IDS` in one place;
  the set test pins the list.
