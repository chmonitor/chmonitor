# Plan 75: Make the unit-test suite a required merge check on main

> **Executor instructions**: Follow step by step. This plan changes CI policy,
> not app code. STOP conditions are binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `gh api repos/chmonitor/chmonitor/branches/main/protection --jq '.required_status_checks.contexts'`
> If the output already includes a unit-test context, mark this plan DONE.

## Status

- **Priority**: P1
- **Effort**: S (plus a flake-sweep)
- **Risk**: MED — starts blocking merges; any flaky test becomes visible
- **Depends on**: none (but do it before landing plans 76–78, whose tests it protects)
- **Category**: dx / verification-baseline
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2492

## Why this matters

Branch protection on `main` requires exactly ONE status check: `dashboard` —
the compile-only Cloudflare build job (`.github/workflows/cloudflare.yml`). The
~300-file bun test suite runs in the `unit-tests` job
(`.github/workflows/test.yml`) but is **not required**, and the project's
standing auto-merge/babysit workflow means a PR that fails tests still merges
if it compiles. Every test in the repo is advisory until this gate exists.

## Current state

- `gh api repos/chmonitor/chmonitor/branches/main/protection --jq '.required_status_checks.contexts'` → `["dashboard"]` (verified 2026-07-10).
- `.github/workflows/test.yml` — `unit-tests` job (~line 29) runs the bun suite.
- `apps/dashboard/CLAUDE.md` lists `unit-tests` among "known non-required checks".
- Known context: `unit-tests` had a bun coverage-writer crash (fixed via #2242/#2246/#2252); residual flakiness is the likely reason it stayed non-required.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Recent flake history | `gh run list --workflow test.yml --branch main --limit 30 --json conclusion,createdAt,url` | mostly success |
| Full local suite | `pnpm run test` (repo root) | exit 0 |
| Add required check | `gh api -X PATCH repos/chmonitor/chmonitor/branches/main/protection/required_status_checks -f 'contexts[]=dashboard' -f 'contexts[]=unit-tests'` | 200 |

## Scope

**In scope**: branch-protection settings (via `gh api`), quarantining/fixing
specific flaky tests found in the sweep, updating the "known non-required
checks" sentence in root `CLAUDE.md` / `apps/dashboard/CLAUDE.md`.

**Out of scope**: making `e2e-test`, `e2e-test-tsr`, `component-test` required
(genuinely flaky infra; separate decision); restructuring test.yml.

## Git workflow

- Branch (for CLAUDE.md/test edits only): `advisor/75-required-unit-tests-check`
- Commit: `chore(ci): make unit-tests a required merge check`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Flake sweep
Inspect the last 30 `test.yml` runs on main. Count non-success conclusions and
open each failing run to identify the failing test file.
**Verify**: a written list (in the PR description) of flaky tests, or "0 flakes in 30 runs".

### Step 2: Fix or quarantine each flaky test
Fix root causes where cheap; otherwise mark with `test.skip` + a `// FLAKY:`
comment and file a follow-up issue per skip.
**Verify**: `pnpm run test` exit 0 locally ×2 consecutive runs.

### Step 3: Add the required check
Use the exact status-check context name as it appears on PR checks (confirm
via `gh pr checks <recent-pr>` — the context may be `unit-tests` or
`Test / unit-tests`). PATCH branch protection to require it alongside `dashboard`.
**Verify**: `gh api .../protection --jq '.required_status_checks.contexts'` includes both.

### Step 4: Update the docs that say it's non-required
Edit the "Known non-required checks" sentences (root `CLAUDE.md` PR Workflow
section, `apps/dashboard/CLAUDE.md` if present) to remove `unit-tests`.
**Verify**: `rg -n "unit-tests" CLAUDE.md apps/dashboard/CLAUDE.md` shows no "non-required" framing.

## Done criteria

- [ ] Branch protection lists a unit-test context as required
- [ ] Last local `pnpm run test` exit 0; flake list empty or quarantined with issues filed
- [ ] CLAUDE.md files updated
- [ ] `plans/README.md` updated

## STOP conditions

- More than ~5 distinct flaky tests in the sweep — the suite isn't gate-ready;
  report the list as its own work item instead of quarantining en masse.
- No `gh` permission to PATCH branch protection (needs repo admin) — report;
  the human must click Settings → Branches instead.

## Maintenance notes

- The in-flight alerting-cluster PRs (26/28/29/30/32/33) all exercise
  `src/lib/health/` tests — landing this gate mid-cascade will block them on
  real failures; that is the point, but sequence consciously.
- Consider later: packages/* test job as a second required context.
