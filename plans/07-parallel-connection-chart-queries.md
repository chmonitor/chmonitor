# Plan 07: Run multi-query charts on user/browser connections in parallel

> **Executor instructions**: Follow step by step; verify each step before the
> next. On a "STOP condition", stop and report. When done, update this plan's
> row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/lib/connection-query/execute-connection-chart.ts`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

Multi-query charts (summary cards that issue several keyed queries) run **sequentially**
on user-added / browser-stored ClickHouse connections, while the env-host path runs the
same queries in parallel. `executeConnectionChartQuery` uses a `for … await` loop
(`execute-connection-chart.ts:45-57`); the env equivalent `executeMultiChartQuery` uses
`Promise.all` (`query-executor.ts:232-254`). So every 30-second poll of a 4-query card on
a "bring-your-own ClickHouse" connection pays the **sum** of query latencies (~600 ms at
150 ms each) instead of the **max** (~150 ms). This regression only hits self-added
connections — exactly the cloud "connect your own cluster" path. The fix parallelizes the
loop while preserving the existing all-or-nothing error behaviour (no downstream change).

## Current state

File: `apps/dashboard/src/lib/connection-query/execute-connection-chart.ts` —
`executeConnectionChartQuery` (`:24`). The serial multi-query branch (`:40-64`):

```ts
if ('queries' in queryDef) {
  const combined: Record<string, unknown[]> = {}
  let executedSql = ''
  const start = Date.now()
  for (const q of queryDef.queries) {                          // ⚠ serial
    const { data } = await queryConnection<Record<string, unknown>>(
      credentials, q.query,
      { clickhouse_settings: timezone ? { session_timezone: timezone } : undefined },
    )
    combined[q.key] = data
    executedSql += `${q.key}: ${q.query}\n`
  }
  return { data: combined, metadata: { duration: Date.now() - start, rows: queryDef.queries.length }, executedSql }
}
```

`queryConnection` is imported from `./connection-client` (`:4`). The two consumers —
`routes/api/v1/user-connections/charts/$name.ts:102` and
`routes/api/v1/browser-connections/charts/$name.ts:77` — just `await` the result and read
`.data` / `.metadata` / `.executedSql`; the return shape must not change.

Exemplar to mirror (`query-executor.ts:232-254`): `Promise.all(queries.map(async (q) => …))`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Unit test | `cd apps/dashboard && bun test src/lib/connection-query --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |
| Grep no serial loop | `rg -n "for \(const q of queryDef.queries\)" apps/dashboard/src/lib/connection-query/execute-connection-chart.ts` | no matches after fix |

## Scope

**In scope**:
- `apps/dashboard/src/lib/connection-query/execute-connection-chart.ts`
- `apps/dashboard/src/lib/connection-query/execute-connection-chart.test.ts` (create)

**Out of scope** (do NOT touch):
- The single-query branch (`:66+`) and `selectSqlForConnection`.
- The env-host path `query-executor.ts` — it is already parallel; this plan only aligns the connection path to it.
- The two consumer routes — the return shape is unchanged, so they need no edits.
- **Do not** add per-query error isolation / partial-result semantics here — the current
  loop throws on the first failing query, and preserving that keeps the consumers unchanged.
  (A per-key error contract like `executeMultiChartQuery`'s is a separate, larger change.)

## Git workflow

- Branch: `advisor/07-parallel-connection-chart-queries`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `perf(connections): run multi-query charts in parallel on user connections`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Replace the serial loop with `Promise.all`, preserving throw-on-first-failure

Rewrite the multi-query branch so all queries start together. `Promise.all` rejects on the
first rejection — matching the current loop's "throws on first failing query" behaviour, so
no consumer change is needed:

```ts
if ('queries' in queryDef) {
  const start = Date.now()
  const entries = await Promise.all(
    queryDef.queries.map(async (q) => {
      const { data } = await queryConnection<Record<string, unknown>>(
        credentials, q.query,
        { clickhouse_settings: timezone ? { session_timezone: timezone } : undefined },
      )
      return [q.key, data, q.query] as const
    }),
  )
  const combined: Record<string, unknown[]> = {}
  let executedSql = ''
  for (const [key, data, query] of entries) {
    combined[key] = data
    executedSql += `${key}: ${query}\n`
  }
  return { data: combined, metadata: { duration: Date.now() - start, rows: queryDef.queries.length }, executedSql }
}
```

(The trailing `for` only assembles already-resolved results — it does no I/O, so ordering
of `executedSql` stays deterministic in `queries` order.)

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0; `rg -n "for \(const q of queryDef.queries\)" apps/dashboard/src/lib/connection-query/execute-connection-chart.ts` → no matches.

### Step 2: Add a test proving correctness + concurrency

Create `execute-connection-chart.test.ts` mocking `queryConnection` from `./connection-client`
(`mock.module('./connection-client', …)`, mirroring the `mock.module` style in
`apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts:21-74`). Cover:
1. **Result assembly** — a 3-query chart returns `data` keyed by each `q.key` with the
   mocked rows, and `metadata.rows === 3`.
2. **Concurrency** — the mock increments a shared `inFlight` counter on entry, yields
   (`await Promise.resolve()` a couple of times), records `maxInFlight`, decrements on
   exit. Assert `maxInFlight === queries.length` (all ran concurrently). If this proves
   flaky in the runtime, downgrade it to asserting `queryConnection` was called once per
   key and remove the timing element — but keep case 1.

**Verify**: `cd apps/dashboard && bun test src/lib/connection-query/execute-connection-chart.test.ts --isolate` → all pass; `bun run lint` → exit 0.

## Test plan

- New file `execute-connection-chart.test.ts`: result-assembly test + concurrency test (above).
- Structural pattern: `polar.test.ts` for `mock.module`.
- Verification: `cd apps/dashboard && bun test src/lib/connection-query --isolate` → all pass, including the new file.

## Done criteria

- [ ] `rg -n "for \(const q of queryDef.queries\)" apps/dashboard/src/lib/connection-query/execute-connection-chart.ts` → no matches
- [ ] The multi-query branch uses `Promise.all`; return shape (`data`/`metadata`/`executedSql`) unchanged
- [ ] `cd apps/dashboard && bun test src/lib/connection-query --isolate` passes, incl. the new test
- [ ] `cd apps/dashboard && bun run type-check` exits 0
- [ ] `cd apps/dashboard && bun run build` exits 0
- [ ] `bun run lint` exits 0
- [ ] Consumer routes unchanged (`git status` lists no `charts/$name.ts`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The multi-query branch has changed since the excerpt (drift), or `queryConnection`'s call
  signature differs.
- A consumer turns out to depend on queries executing in order (search shows any reliance on
  sequential side effects) — parallelizing would change behaviour; report instead.

## Maintenance notes

- Reviewer: confirm error behaviour is unchanged (first rejection still fails the whole
  call) and the return shape is identical.
- If per-query error isolation (partial charts) is later wanted here, mirror
  `executeMultiChartQuery`'s `{ key, dataJson, error }` contract — that is a deliberate
  follow-up, not this plan, because it changes what the consumer routes receive.
