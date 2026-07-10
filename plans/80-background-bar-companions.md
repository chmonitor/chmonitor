# Plan 80: Fix BackgroundBar columns missing their pct_ companions + repo-wide invariant test

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/query-config apps/dashboard/src/components/data-table/cells/background-bar-format.tsx`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive SQL columns)
- **Depends on**: none
- **Category**: bug (charts/tables rendering)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2497

## Why this matters

The BackgroundBar cell renders a comparative bar only when the row carries a
`pct_<column>` companion. Three shipped configs declare `BackgroundBar` on
columns whose companion doesn't exist in the SQL, so they silently render a
plain number — the same regression class as issue #2139, whose guard test
explicitly covers only 9 configs.

## Current state

Renderer `apps/dashboard/src/components/data-table/cells/background-bar-format.tsx:31-41`:

```ts
const colName = columnName.replace('readable_', '')
const pctColName = `pct_${colName}`
...
if (pct === undefined || pct === null || !Number.isFinite(Number(pct))) {
  return value   // ← silent fallback, no bar
}
```

Note it strips only `readable_`, NOT `pct_` — so a column *named* `pct_count`
looks up `pct_pct_count`.

Broken declarations (verified against each config's SQL):

- `lib/query-config/more/top-usage-tables.ts:81` — `pct_count: BackgroundBar` → needs `pct_pct_count` (absent; SQL has `pct_count` only, lines 21/41)
- `lib/query-config/more/top-usage-tables.ts:84` — `cache_hit_rate: BackgroundBar` → `pct_cache_hit_rate` absent
- `lib/query-config/more/top-usage-columns.ts:70,73` — same two columns, same gap
- `lib/query-config/system/latency-log.ts:54` — `avg_us: BackgroundBar` → `pct_avg_us` absent (SQL line 28 defines only `pct_events`)

Working example for comparison: `latency-log.ts:53` `readable_events` →
strips to `events` → `pct_events` exists → bar renders.

Existing guard test: `apps/dashboard/src/lib/query-config/background-bar-companions.test.ts`
— scoped to 9 configs, self-describes that a repo-wide invariant "would be valuable".

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/lib/query-config` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |
| CH-backed config tests (optional) | `pnpm run test:query-config` | pass (needs CH container) |

## Scope

**In scope**: the three config files above (SQL + column formats), widening
`background-bar-companions.test.ts` to iterate ALL registered configs
(`lib/query-config/index.ts` registry).

**Out of scope**: the renderer (`background-bar-format.tsx`) — changing its
prefix-stripping is riskier than fixing the configs; leave it.

## Git workflow

- Branch: `advisor/80-background-bar-companions`
- Commit: `fix(query-config): add missing pct_ companions for BackgroundBar columns`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Fix the three configs
For each broken column, either add the SQL companion or re-point the format:
- `pct_count` declared BackgroundBar: since the column IS already a percentage,
  add `pct_pct_count` = itself in SQL (`pct_count AS pct_pct_count`) OR change
  the column format to plain number — pick the one matching how the sibling 9
  guarded configs handle percentage columns (read 2 of them first; follow the
  BackgroundBar column triple documented in root CLAUDE.md: base +
  `readable_` + `pct_`).
- `cache_hit_rate`: add `round(cache_hit_rate, 2) AS pct_cache_hit_rate`
  (already 0–100) to both SQL variants in each file (there are versioned SQL
  arrays — update every `{ since, sql }` entry).
- `avg_us` in latency-log: add
  `round(avg_us * 100.0 / nullIf(max(avg_us) OVER (), 0), 2) AS pct_avg_us`.
**Verify**: `bun test src/lib/query-config` passes (existing tests).

### Step 2: Widen the invariant test
Rewrite `background-bar-companions.test.ts` to iterate every config in the
central registry: for each column declared `BackgroundBar`, assert the SQL text
of EVERY version variant contains `pct_<strippedName>` (reuse the test's
existing companion-derivation logic; keep its 9 explicit cases as anchors if
convenient).
**Verify**: `bun test src/lib/query-config/background-bar-companions.test.ts` fails before Step 1 configs are fixed and passes after (run order: you may write the test first).

## Done criteria

- [ ] All three configs render bars (companions present in every SQL variant)
- [ ] Invariant test iterates the full registry and passes
- [ ] Build green; `plans/README.md` updated

## STOP conditions

- A config's SQL is versioned and a companion can't be expressed on an old
  ClickHouse version (window functions pre-21.x) — report the version floor
  instead of guessing.
- The registry exposes configs lazily in a way the test can't enumerate — report.

## Maintenance notes

- New BackgroundBar columns are now caught by the widened test at PR time.
- Reviewer: eyeball one affected page (Top Usage Tables) to confirm bars render.
