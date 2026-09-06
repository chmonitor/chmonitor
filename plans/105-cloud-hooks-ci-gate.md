# Plan 105: Run cloud-hooks tests in the required unit-tests CI job

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- .github/workflows/test.yml apps/cloud-hooks/package.json`
> If test.yml changed since this plan was written, re-read the `unit-tests` job
> before proceeding.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / ci
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3301

## Why this matters

The money path (`apps/cloud-hooks`: Polar webhook verification, license
checkout/lookup/register, Clerk seat handling, cron jobs) has ~20 co-located
test files that **only run in the deploy workflow's path-filtered job**
(`.github/workflows/cloudflare.yml:1034`, Test step gated on
`steps.filter.outputs.cloud_hooks == 'true' || workflow_dispatch || release || tag`).
Any PR touching shared code outside those paths merges with green required
checks having executed zero money-path tests. The required `unit-tests` job in
`.github/workflows/test.yml` runs only dashboard coverage, package tests, and
the agent-eval parser — not cloud-hooks.

## Current state

`.github/workflows/test.yml` `unit-tests` job (lines 29–84) runs exactly:

```yaml
- name: Run Bun tests with coverage
  working-directory: apps/dashboard
  run: pnpm run test:coverage:ci

- name: Run workspace package tests with coverage
  run: pnpm run test:packages:ci

- name: Agent eval SSE parser
  run: bun test tests/agent --isolate

- name: Upload Bun coverage to Codecov
  uses: codecov/codecov-action@v7
  with:
    files: ./apps/dashboard/coverage/lcov.info,./coverage/lcov.info
```

cloud-hooks has its own lockfile (`apps/cloud-hooks/pnpm-lock.yaml`) and its
deploy job installs with `pnpm install --frozen-lockfile` from
`working-directory: apps/cloud-hooks`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Local suite check | `cd apps/cloud-hooks && pnpm install --frozen-lockfile && bun test src/ --isolate` | all pass |
| Lint the workflow | `pnpm exec yaml-lint .github/workflows/test.yml 2>/dev/null \|\| python3 -c "import yaml;yaml.safe_load(open('.github/workflows/test.yml'))"` | exit 0 |

## Scope

**In scope**:
- `.github/workflows/test.yml` only

**Out of scope**:
- `.github/workflows/cloudflare.yml` (deploy workflow keeps its own gated Test
  step for deploys)
- Any workflow under `claude*.yml`
- Branch protection settings (repo-admin action; noted in maintenance)

## Git workflow

- Branch: `advisor/105-cloud-hooks-ci-gate`
- Commit: `test(ci): add cloud-hooks suite to required unit-tests job` + Co-Authored-By trailer per AGENTS.md.

## Steps

### Step 1: Add install + test steps to `unit-tests`

In `.github/workflows/test.yml`, inside job `unit-tests`, after the existing
"Agent eval SSE parser" step, insert:

```yaml
      - name: Install cloud-hooks dependencies
        if: >-
          github.event_name != 'pull_request' ||
          github.event.pull_request.head.repo.full_name == github.repository
        working-directory: apps/cloud-hooks
        run: pnpm install --frozen-lockfile

      - name: Run cloud-hooks tests
        if: >-
          github.event_name != 'pull_request' ||
          github.event.pull_request.head.repo.full_name == github.repository
        working-directory: apps/cloud-hooks
        run: bun test src/ --isolate
```

The `if:` guard mirrors the fork-skip condition already used by the
`cloud-hooks` job in cloudflare.yml (fork PRs must not get repo-secrets-scoped
installs; here there are no secrets, but keeping the same condition avoids a
new failure class on forks without their own lockfile-compatible environment).
If the maintainer prefers running it on forks too, drop both `if:` blocks —
either is acceptable; note which you chose in NOTES.

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))"` → exit 0.

### Step 2: Add lcov to codecov upload (optional, best-effort)

Only if trivial: extend the codecov `files:` list with
`./apps/cloud-hooks/coverage/lcov.info` AND add `--coverage-reporter=lcov` to
its test invocation (`bun test src/ --isolate --coverage-reporter=lcov`,
creating `coverage/lcov.info`). If Bun's coverage writer flakes on this suite
(the known `WriteFailed` issue documented at test.yml:60–64), revert this step
and keep the plain test run. Coverage upload is secondary; the gate is primary.

## Test plan

No new unit tests. Verification: push the branch and confirm the `unit-tests`
job log contains a line like `src/license-checkout.test.ts:` (canary proving
money-path tests execute inside the required job).

## Done criteria

- [ ] YAML parses; `unit-tests` job includes the two new steps
- [ ] `cd apps/cloud-hooks && bun test src/ --isolate` passes locally before pushing
- [ ] No other files modified

## STOP conditions

- The cloud-hooks suite fails locally on current main → report the failing test(s); do NOT fix them as part of this plan.
- Fork-PR failures appear after merge (install errors on forks) → report; maintainer may prefer the unconditional variant.

## Maintenance notes

- Once merged, any new cloud-hooks module must keep its tests fast enough for
  the 10-minute job timeout (currently ~2s total — plenty of headroom).
- If a future split makes cloud-hooks depend on more workspace packages, revisit
  whether `pnpm install` at root is also needed in these steps.
- Reviewers: verify the canary line appears in the first CI run on the PR.
