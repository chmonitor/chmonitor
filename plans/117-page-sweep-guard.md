# Plan 117: Close the page-render sweep's coverage gap (27+ routes missing)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/cypress/e2e/page-render-sweep.cy.ts 'apps/dashboard/src/routes/(dashboard)/'`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (newly swept legacy routes may expose PRE-EXISTING render errors — triage budget required; that is the point, but expect it)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3312

## Why this matters

`cypress/e2e/page-render-sweep.cy.ts` claims in its header: "Hardcoded so that
adding a new route without updating this list fails the suite" — but nothing
enforces list-vs-routes parity and 27+ shipped routes are absent, including all
three diff/advisor pages (`/advisor`, `/schema-diff`, `/settings-diff`), the
highest-churn new surfaces since July. A module-level crash on those pages
ships silently today; the sweep's core value erodes with every added page.

## Current state

`apps/dashboard/cypress/e2e/page-render-sweep.cy.ts:15–97`: `DASHBOARD_ROUTES`
array + loop visiting each with auth bypassed per the file's setup.
Missing entries found by diffing against `src/routes/(dashboard)/*.tsx`
(verify yourself at execution time): `/advisor`, `/schema-diff`,
`/settings-diff`, `/fleet`, `/setup`, `/sql`, `/traffic`, `/storage-economics`,
`/top-cpu-queries`, `/top-memory-queries`, `/slow-query-patterns`,
`/ttl-partition-health`, `/workload-scheduling`, `/inbound-events`,
`/index-analytics`, `/opentelemetry-spans`, `/histogram-metrics`,
`/asynchronous-inserts`, `/background-schedule-pool`, `/blob-storage-log`,
`/query-condition-cache`, `/rabbitmq-consumers`, `/recent-queries`,
`/mcp-servers`, `/alert-settings`, `/health-settings`, `/insights-settings`,
`/report-settings`. Helper files are `-`-prefixed (not routes).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Guard test | `cd apps/dashboard && bun test scripts/cron-triggers.test.ts --isolate` | pass (pattern reference) |
| E2E sweep | `pnpm run test:e2e:headless -- --spec cypress/e2e/page-render-sweep.cy.ts` (requires dev server per repo docs; if not feasible locally, rely on CI e2e job) | all routes render |

## Scope

**In scope**:
- `apps/dashboard/cypress/e2e/page-render-sweep.cy.ts` (add entries)
- NEW `apps/dashboard/scripts/page-sweep-parity.test.ts` (bun guard test)

**Out of scope**:
- Fixing any render bug the expanded sweep exposes → file each as its own
  finding/report; do not patch app code here beyond trivially-skipping a route
  with a documented reason constant.
- Component tests, other e2e specs

## Git workflow

- Branch: `advisor/117-page-sweep-parity`
- Commit: `test(e2e): add missing routes to page-render sweep + parity guard`

## Steps

1. Regenerate the missing-route list at execution time by walking
   `src/routes/(dashboard)` for non-`-` `.tsx` files and diffing against
   `DASHBOARD_ROUTES`; add ALL of them (the audit's list above is a hint, not
   gospel).
2. Write `scripts/page-sweep-parity.test.ts` (bun:test): parse the cy.ts file,
   walk the routes dir, assert set equality modulo an explicit
   `SWEEP_EXCLUDED_ROUTES` allowlist constant (empty by default). Pattern:
   `scripts/cron-triggers.test.ts`.
3. Run the sweep locally if a dev server is available (repo has run skill /
   ui-ux-audit conventions); otherwise push and let CI e2e run. For any route
   failing to render: check quickly whether the failure is environmental
   (needs ClickHouse data) vs a real crash; add real crashes to the report as
   findings, environmental ones to `SWEEP_EXCLUDED_ROUTES` with comments.

## Done criteria

- [ ] Parity guard passes; DASHBOARD_ROUTES covers every current dashboard route (or excluded with reason)
- [ ] Expanded sweep green in CI (or failures filed as explicit findings)
- [ ] No app source changes

## STOP conditions

- More than 5 newly swept routes crash for non-environmental reasons → land the guard + the green subset only, STOP, report the rest (indicates a broader regression needing triage before this merges wholesale).

## Maintenance notes

- The guard makes future route additions self-enforcing; reviewers should
  reject PRs adding `SWEEP_EXCLUDED_ROUTES` entries without comments.
