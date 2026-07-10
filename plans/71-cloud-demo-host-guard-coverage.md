# Plan 71: Apply the cloud demo-host guard to every hostId-serving API route

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/routes/api/v1 apps/dashboard/src/lib/cloud`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against live code; on mismatch treat as STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2488

## Why this matters

On the Cloud (SaaS) deployment, env hosts are a public read-only demo that must
be **hidden from signed-in users** (they see only their own D1 connections).
`apps/dashboard/src/lib/cloud/reject-demo-host.ts` exports
`isDemoHostBlockedForRequest()` to enforce this server-side — the client hiding
is explicitly best-effort. The guard is called by ~22 routes (charts, tables,
explorer, insights, overview, health, …) but is **missing from 10 other routes
that accept a `hostId` and query ClickHouse**. A signed-in cloud user with a
stale `?host=0` URL or a hand-crafted request can still read demo-host data
through those routes. `data.ts` is the worst: it executes registered SQL by
hostId. Self-hosted/OSS is unaffected (the guard early-returns when not cloud).

## Current state

Routes ALREADY calling the guard (pattern to copy) — e.g.
`apps/dashboard/src/routes/api/v1/charts/$name.ts` (call near line 78), and the
existing coverage test
`apps/dashboard/src/routes/api/v1/charts/__tests__/cloud-demo-host-guard.test.ts`.

Routes MISSING the guard (verified by grep at the planned-at commit):

- `apps/dashboard/src/routes/api/v1/data.ts` (hostId validated ~line 184)
- `apps/dashboard/src/routes/api/v1/cluster-topology.ts` (~line 113)
- `apps/dashboard/src/routes/api/v1/menu-counts/index.ts` (~line 108)
- `apps/dashboard/src/routes/api/v1/cluster-counts/$key.ts`
- `apps/dashboard/src/routes/api/v1/settings-diff.ts`
- `apps/dashboard/src/routes/api/v1/management.ts`
- `apps/dashboard/src/routes/api/v1/advisor.ts`
- `apps/dashboard/src/routes/api/v1/explain.ts`
- `apps/dashboard/src/routes/api/v1/table-availability.ts`
- `apps/dashboard/src/routes/api/v1/tables/index.ts`

Convention: the guarded routes resolve the numeric hostId, then call
`isDemoHostBlockedForRequest(request, hostId)` (see `charts/$name.ts` for the
exact call shape and the 403/404 response it returns). Match it exactly.

## Commands you will need

| Purpose   | Command                                        | Expected on success |
|-----------|------------------------------------------------|---------------------|
| Install   | `cd apps/dashboard && pnpm install`            | exit 0              |
| Typecheck + build | `cd apps/dashboard && pnpm run build`  | exit 0              |
| Targeted tests | `cd apps/dashboard && bun test src/routes/api/v1` | all pass       |
| Lint      | `pnpm run lint` (repo root)                    | exit 0              |

## Scope

**In scope**:
- The 10 route files listed above.
- A new shared helper (suggested: extend `apps/dashboard/src/lib/cloud/reject-demo-host.ts` with a `assertDemoHostAllowed(request, hostId)` that returns the error `Response` or `null`).
- Extend/add tests: widen `cloud-demo-host-guard.test.ts` (or a sibling) so every `api/v1` route file that resolves a numeric hostId is asserted to reference the guard.

**Out of scope**:
- `apps/dashboard/src/lib/health/server-sweep.ts` (under separate reconciliation).
- Client-side demo-hiding (`lib/swr/use-merged-hosts.ts`) — already correct.
- Any change to OSS behaviour: the guard must keep early-returning when `isCloudModeServer()` is false.

## Git workflow

- Branch: `advisor/71-cloud-demo-host-guard-coverage`
- Semantic commits, e.g. `fix(cloud): enforce demo-host guard on all hostId API routes`
- Include trailer `Co-Authored-By: duyetbot <bot@duyet.net>`. Do not push unless instructed.

## Steps

### Step 1: Read the existing guard and one guarded route
Read `lib/cloud/reject-demo-host.ts` and `routes/api/v1/charts/$name.ts` to
copy the exact call + response shape.
**Verify**: you can state the guard's return type and the HTTP status it produces.

### Step 2: Add the guard to each of the 10 routes
Insert the guard immediately after the route resolves/validates its numeric
hostId, returning the same response the charts route returns when blocked. Keep
each diff minimal.
**Verify**: `rg -L "isDemoHostBlockedForRequest" apps/dashboard/src/routes/api/v1 --files-without-match -g '*.ts' -g '!**/__tests__/**'` — none of the 10 files listed above appear.

### Step 3: Add a regression coverage test
Model on `charts/__tests__/cloud-demo-host-guard.test.ts`. Best shape: a test
that enumerates route files under `src/routes/api/v1/**` whose source matches
`validateHostId|hostId` + ClickHouse fetch, and asserts each file's source
includes `isDemoHostBlockedForRequest`. This makes the invariant self-enforcing
for future routes.
**Verify**: `cd apps/dashboard && bun test src/routes/api/v1 --isolate` → all pass; temporarily deleting one guard call makes the new test fail (restore it).

### Step 4: Full build
**Verify**: `cd apps/dashboard && pnpm run build` → exit 0.

## Test plan

- New/extended test as in Step 3 (source-coverage invariant).
- If the repo's existing guard test mocks requests per-route, add at least one
  behavioural test for `data.ts`: cloud mode + signed-in principal + `hostId=0`
  → blocked response; OSS mode → passes through.

## Done criteria

- [ ] All 10 listed routes call the guard (grep-verified as in Step 2)
- [ ] New coverage test exists and fails when a guard call is removed
- [ ] `pnpm run build` exit 0; `bun test src/routes/api/v1` all pass
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` row updated

## STOP conditions

- A listed route turns out not to accept a hostId or not to query ClickHouse
  (re-check before adding a guard that would 500).
- The guard's signature in `reject-demo-host.ts` differs from what `charts/$name.ts`
  uses (drift since planning).
- Adding the guard to `management.ts` or `advisor.ts` breaks an existing test
  that asserts anonymous/OSS access — report rather than weaken the guard.

## Maintenance notes

- Any NEW `api/v1` route that resolves a hostId must call the guard; the Step 3
  test should catch omissions — keep it enumerating files, not a fixed list.
- Reviewer: check the guard is inserted AFTER hostId validation (so invalid ids
  still get 400, not 403) and BEFORE any ClickHouse query.
