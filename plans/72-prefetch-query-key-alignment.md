# Plan 72: Fix hover-prefetch cache keys so prefetched data is actually used

> **Executor instructions**: Follow step by step; run every verification. On
> any STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/swr/prefetch.ts apps/dashboard/src/lib/query/use-chart-data.ts apps/dashboard/src/lib/query/use-table-data.ts`
> On changes, re-compare the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2489

## Why this matters

Nav-link hover prefetch (`prefetchRoute`) fires real `/api/v1/charts` and
`/api/v1/tables` requests (each a Worker→ClickHouse round-trip; ~28–30 for the
overview route) and seeds the TanStack Query cache — but under a **different
query key** than the live hooks read. TanStack Query hashes the whole key
array, so the seeded entries are never hit: the feature is dead weight that
adds pure extra load on the user's ClickHouse cluster on every hover.

## Current state

`apps/dashboard/src/lib/swr/prefetch.ts:22-30` seeds a **7-element** chart key:

```ts
const queryKey = [
  '/api/v1/charts', chartName, hostId,
  undefined, // interval
  undefined, // lastHours
  JSON.stringify(null), // params
  undefined, // timezone
]
```

`apps/dashboard/src/lib/query/use-chart-data.ts:94-103` reads an **8-element** key:

```ts
const queryKey = [
  '/api/v1/charts', chartName, hostId, interval, lastHours,
  JSON.stringify(params ?? null), timezone,
  hostConnectionKey(numericHostId, browserConnection),   // ← missing in prefetch
] as const
```

Same defect for tables: `prefetch.ts:57-63` (5 elements) vs
`use-table-data.ts` queryKey (6 elements, extra `hostConnectionKey`).
`hostConnectionKey` comes from the host-fetch resolution layer (grep
`hostConnectionKey` under `apps/dashboard/src/lib` for its module); for env
hosts (hostId >= 0, no browser connection) it produces a deterministic value —
compute the same value in the prefetch path.

Caller: `apps/dashboard/src/components/menu/link-with-context.tsx`
(`handleMouseEnter` → `prefetchRoute`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build   | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests   | `cd apps/dashboard && bun test src/lib/swr src/lib/query` | all pass |
| Lint    | `pnpm run lint` | exit 0 |

## Scope

**In scope**: `apps/dashboard/src/lib/swr/prefetch.ts`, a new shared key-factory
module (suggested `apps/dashboard/src/lib/query/query-keys.ts`),
`use-chart-data.ts`, `use-table-data.ts`, new test file.

**Out of scope**: `route-prefetch-map.ts` contents; refetch/staleTime behaviour;
`link-with-context.tsx` (unless import path changes).

## Git workflow

- Branch: `advisor/72-prefetch-query-key-alignment`
- Commit: `fix(prefetch): align prefetch cache keys with live query keys`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Extract shared key factories
Create `chartQueryKey({chartName, hostId, interval, lastHours, params, timezone, connectionKey})`
and `tableQueryKey(...)` in one module; switch `use-chart-data.ts` and
`use-table-data.ts` to build their keys through them (no behaviour change —
byte-identical key arrays).
**Verify**: `bun test src/lib/query` passes; `pnpm run build` exit 0.

### Step 2: Use the factories in prefetch.ts
Compute the same `hostConnectionKey(hostId, null)` the hooks produce for an env
host with no browser connection and pass it through the factory.
**Verify**: `rg -n "queryKey = \[" apps/dashboard/src/lib/swr/prefetch.ts` → no inline key arrays remain.

### Step 3: Regression test
New test (e.g. `src/lib/query/query-keys.test.ts`): assert
`chartQueryKey(...)` for a default env-host prefetch deep-equals the key
`use-chart-data` builds for the same inputs (import both paths; compare arrays).
Same for tables.
**Verify**: `bun test src/lib/query` → all pass, including the new tests.

## Test plan

- `query-keys.test.ts`: chart key parity (default args), table key parity,
  and a case with explicit interval/params to pin factory ordering.
- Pattern: any existing test under `src/lib/query/` or `src/lib/swr/`.

## Done criteria

- [ ] Prefetch and hooks build keys via one shared factory (grep confirms no duplicated inline arrays)
- [ ] Parity tests exist and pass
- [ ] `pnpm run build` exit 0
- [ ] `plans/README.md` updated

## STOP conditions

- `hostConnectionKey` requires browser-connection state unavailable outside
  React (would need a different prefetch design — report, don't hack).
- Key shapes changed since planning (drift check).

## Maintenance notes

- Any future addition to the hooks' query keys MUST go through the factory, or
  prefetch silently dies again — the parity test is the tripwire.
- Reviewer: confirm the factory is the only place the key literal exists.
