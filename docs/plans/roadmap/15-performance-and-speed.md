# 15 — Performance & Speed

> Priority: P1 · Effort: M · Risk: LOW · Depends on: none
> Category: Quality · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

"Fast and professional" is a core value, but today speed is only partially
defended:

- **Bundle size is _reported_, not _enforced_.** `.github/workflows/bundle-size.yml`
  measures the worker gzip size via `bunx wrangler deploy --minify --dry-run`,
  annotates `::warning::` at 2.5 MiB and `::error::` at 3.0 MiB, but the job is
  `continue-on-error: true` and **not a required check**. Baseline is ~1.82 MiB
  gzip (PR #1613). A regression can merge silently; nothing tracks the delta
  against a committed budget.
- **No runtime perf budget.** There is no TTFB / render-time / route-payload
  assertion anywhere in CI. `a11y.yml` and `test.yml` exist; there is no
  `perf.yml`.
- **Query efficiency on the user's cluster is unmeasured and unbounded.** The
  dashboard fetches client-side (SWR) against `api/v1/*` handlers that run
  ClickHouse queries through `@chm/clickhouse-client`. There is no assertion that
  a dashboard load stays within a bounded number of queries / rows-read, and no
  guardrail preventing a new panel from adding a heavy `system.query_log` scan on
  every poll. This directly threatens the "zero-added-load" ideal we want to
  mirror from ClickHouse Cloud.
- **Caching is ad hoc.** Only `lib/version-cache.ts` and
  `clickhouse-client/table-existence-cache.ts` cache reads; KV is available but
  not used as a systematic read cache for expensive, slow-changing panels.

## Goal

**A merged PR that raises worker gzip bundle >3% over the committed baseline, or
regresses the measured dashboard-load query budget, fails a _required_ CI check.**
(One measurable outcome: a perf regression is blocked, not just annotated.)

## Design

### 1. Turn bundle-size into an enforced budget with delta tracking

- Commit a machine-readable baseline: `apps/dashboard/perf-budget.json`
  ```json
  {
    "workerGzipKiB": { "baseline": 1820, "warnDeltaPct": 3, "hardKiB": 3072 }
  }
  ```
- Extend `bundle-size.yml`: after parsing gzip KiB, compare to
  `perf-budget.json.baseline`. Emit `::error::` and **exit 1 (no
  `continue-on-error`)** when either (a) `gzip > baseline * (1 + warnDeltaPct/100)`
  or (b) `gzip > hardKiB`. Keep the PR step-summary table. A justified increase
  updates the baseline in the same PR (reviewer sees the delta in the diff) —
  the budget file _is_ the changelog.
- Add the job to the required-checks set (documented in the plan's Done
  checklist; branch-protection is a repo-settings change, noted for the human).

### 2. Add a runtime perf budget (TTFB + route payload) as a real gate

- New script `apps/dashboard/scripts/perf-budget.ts` (Bun): boots the built
  worker locally (`wrangler dev` or the node build `server/index.mjs`), hits a
  fixed set of routes (`/`, `/api/healthz`, one representative `api/v1/*` data
  route against a **mock/fixture ClickHouse**, never a real cluster), and asserts:
  - server TTFB for `/api/healthz` < budget (e.g. 150 ms local),
  - initial HTML transfer size for `/` < budget,
  - the representative data route returns within a payload-size budget.
  Budgets live in `perf-budget.json`. Fixtures live in
  `apps/dashboard/src/**/__fixtures__` — **no live cluster in CI**.
- New workflow `.github/workflows/perf.yml` runs it on PRs. Required.

### 3. Bound query load on the user's cluster (the zero-added-load guarantee)

- Add a **query-cost budget** to the declarative query-config layer. Each
  query-config panel already declares its SQL/shape; annotate each with a
  `costClass` (`cheap` = system tables / `async_metric_log` cached reads;
  `heavy` = `system.query_log`/`system.parts` scans) and a `pollable` flag.
- New unit test `packages/*/__tests__/query-budget.test.ts`: assert that (a)
  every panel rendered on the **default dashboard load** is `costClass: cheap` or
  explicitly cached, and (b) no `pollable` panel issues a `heavy` scan on its
  refresh interval. This is the mechanical enforcement of "never add query-load
  surprises." Prefer `async_metric_log` / `asynchronous_metric_log` (already
  referenced in `clickhouse-client/src/clickhouse-version.ts`) and cached reads
  over live `query_log` aggregation for anything on a poll timer.
- Where a `heavy` read is unavoidable for a slow-changing panel, route it through
  a **KV read cache** (see 4) with a documented TTL so the cluster is hit at most
  once per TTL per host, not once per viewer.

### 4. Systematic KV read cache for expensive, slow-changing reads

- Generalize `lib/version-cache.ts` into `lib/cache/kv-read-cache.ts`: a
  `cachedRead(key, ttlSec, fetcher)` helper backed by the existing KV binding,
  with a stable cache-key scheme (`host:{id}:panel:{name}:{paramsHash}`). Slow
  panels (cluster topology, settings-diff, table availability) opt in.
- Falls open on self-host with no KV (calls the fetcher directly) — self-hosted
  stays whole.

## Steps

1. **(S)** Add `apps/dashboard/perf-budget.json` with the worker gzip baseline
   (1820 KiB) + warn-delta + hard-limit constants; document the file in
   `docs/knowledge/worker-bundle-size.md`.
2. **(S)** Rework `bundle-size.yml` to read `perf-budget.json`, compute the delta
   vs baseline, remove `continue-on-error`, and fail on >warnDeltaPct or >hardKiB.
3. **(M)** Add `scripts/perf-budget.ts` (Bun) + `__fixtures__` mock-ClickHouse
   responses; assert TTFB + HTML size + representative route payload budgets.
   *Split:* (3a) fixture + local-boot harness; (3b) route assertions + budget
   wiring.
4. **(S)** Add `.github/workflows/perf.yml` running step 3 on PRs; mark it
   required in the Done checklist.
5. **(M)** Add `costClass`/`pollable` annotations to query-config panels + the
   `query-budget.test.ts` assertion. *Split:* (5a) annotate + type; (5b) test
   asserting default-load panels are cheap/cached and no heavy poll.
6. **(S)** Add `lib/cache/kv-read-cache.ts`; migrate `version-cache.ts` and 1–2
   heavy slow-changing panels onto it; fall-open when KV absent.

## Real test

Two tests that fail today, pass after:

1. **Bundle budget (CI):** in `bundle-size.yml`, a synthetic run with a stubbed
   gzip value of `baseline * 1.04` exits non-zero. Today the job always exits 0
   (`continue-on-error`). Prove with a unit test of the delta math
   (`scripts/__tests__/bundle-delta.test.ts`) asserting `4% over baseline → fail`,
   `2% over → pass`.
2. **Query budget (unit):** `query-budget.test.ts` — introduce a panel marked
   `pollable` + `heavy` in a fixture registry and assert the validator rejects it;
   assert the real default-dashboard panel set passes. Fails today (no such
   validator), passes after.

## Verification

```
# bundle budget math + query budget
cd apps/dashboard && bun test scripts/__tests__/bundle-delta.test.ts
bun test packages/*/src/**/query-budget.test.ts

# runtime perf budget locally
cd apps/dashboard && bun run scripts/perf-budget.ts

# proves the real worker size the CI gate reads
cd apps/dashboard && bunx vite build && bunx wrangler deploy --minify --dry-run

# nothing regressed
bun run lint && bun run build && bun run test:unit
```

## Out of scope / STOP conditions

- **No query-load surprises on real clusters.** CI must never point perf tests at
  a user's ClickHouse — fixtures only. The query-budget test is the guardrail
  that keeps _future_ panels honest.
- Do not add Durable Objects or a new datastore for caching; reuse the existing
  KV binding. KV cache must fall open on self-host (no KV) so self-hosted stays
  whole.
- No micro-optimizations that hurt readability for <1% wins; the budgets define
  what "fast enough" means — chase them, not vanity numbers.
- Do not lower the hard 3.0 MiB ceiling (CF free-plan limit) or raise the
  baseline without a reviewed diff to `perf-budget.json`.

## Done

- [ ] `perf-budget.json` committed; `bundle-size.yml` enforces delta + no longer
      `continue-on-error`; `perf.yml` added and green.
- [ ] `query-budget.test.ts` + panel annotations landed; default load proven
      cheap/cached.
- [ ] `kv-read-cache.ts` in place; ≥1 heavy panel migrated; falls open sans KV.
- [ ] `bun run lint && bun run build && bun run test:unit` green.
- [ ] Docs updated: `docs/knowledge/worker-bundle-size.md` (budget file), a
      perf-budgets note in contributor docs.
- [ ] Note for human: add `bundle-size` + `perf` to GitHub branch-protection
      required checks.
- [ ] Flip the status row for **#15** in `plans/roadmap/README.md` to `DONE`
      (or `IN REVIEW`).
