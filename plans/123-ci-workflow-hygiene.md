# Plan 123: CI hygiene — concurrency groups, turbo cache, Cypress cache key

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- .github/workflows/`
> On mismatch, re-read the affected workflows.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW (concurrency/caching config only; publish jobs get non-cancelling groups)
- **Depends on**: none
- **Category**: dx / ci
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3318

## Why this matters

1. Eight workflows lack concurrency groups (`docs.yml`, `blog.yml`,
   `landing.yml`, `cli-rust-ci.yml`, `cargo-publish.yml`, `helm-release.yml`,
   `claude.yml`, `base.yml` per audit grep — re-verify): rapid pushes stack
   redundant full builds; cargo-publish can race itself.
2. Turbo builds have no cross-run cache (no remote cache, no cached
   `--cache-dir` in `base.yml`) — every lint/build leg recompiles from scratch.
3. `test.yml:124` Cypress cache key hashes `**/bun.lock` — no such file exists
   anywhere, so the key never varies; stale binaries persist until a manual
   `-v1`→`-v2` bump. Should hash `apps/dashboard/pnpm-lock.yaml`.

## Current state

Existing concurrency exemplar: `.github/workflows/test.yml:11–13` /
`ci.yml:15–17`:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.head_ref || github.ref }}
  cancel-in-progress: true
```
Cache exemplars: pnpm store via setup-node `cache: pnpm`; no turbo caching
anywhere.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| YAML validity | `python3 -c "import yaml,glob; [yaml.safe_load(open(f)) for f in glob.glob('.github/workflows/*.yml')]"` | exit 0 |
| actionlint if available | `actionlint .github/workflows/*.yml || true` | no new errors |

## Scope

**In scope**:
- The workflows missing `concurrency:` (re-grep at execution time)
- `test.yml` Cypress cache key line
- Optional: turbo cache-dir via actions/cache in base.yml (see STOP)

**Out of scope**:
- Remote-cache service signup / secrets (needs operator account) — leave a
  commented example instead
- Job logic changes

## Git workflow

- Branch: `advisor/123-ci-concurrency-cache`
- Commit: `ci: add concurrency groups and fix cypress cache key`

## Steps

1. Add the standard concurrency block to each listed workflow;
   `cancel-in-progress: false` for `cargo-publish.yml` + `helm-release.yml`.
2. Fix test.yml Cypress key to
   `key: ${{ runner.os }}-cypress-v1-${{ hashFiles('apps/dashboard/pnpm-lock.yaml') }}`.
3. Turbo cache (optional but recommended): wrap base.yml build/lint steps with
   actions/cache on `~/.cache/.turbo` keyed by `${{ runner.os }}-turbo-${{ github.sha }}`
   restore-key `${{ runner.os }}-turbo-`, plus pass `--cache-dir`
   accordingly; add a PR comment noting Vercel Remote Cache as the better
   long-term option (needs TURBO_TOKEN secret — out of scope).

## Done criteria

- [ ] All workflows parse; every non-publish workflow has a cancelling group, publishes non-cancelling
- [ ] Cypress key references an existing lockfile path
- [ ] No job semantics changed otherwise

## STOP conditions

- A workflow intentionally runs concurrent variants (matrix over same ref) where cancellation would break correctness → skip it, note why.

## Maintenance notes

- Watch first week of CI for cancelled-in-progress surprises on release branches.
