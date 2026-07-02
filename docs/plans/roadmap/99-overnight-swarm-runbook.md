# 99 — Overnight Autonomous Swarm Runbook

> How a Claude Code swarm executes this roadmap unattended, overnight, without
> stopping — with **auto-merge of green PRs** (the owner's chosen autonomy level).
> Planned at commit `ab4c34426`, 2026-07-02.

This runbook is both documentation and the **operating contract** the agents
follow. The ready-to-paste launch prompt is in §7.

---

## 1. Model of operation

- **Source of truth = the tracker** in [`README.md`](README.md). Every unit of
  work is a plan file with a status row. Agents never invent work outside the
  tracker; if they discover new work, they add a row (status `TODO`) and keep going.
- **One plan = one branch = one PR.** Small, reviewable, independently green.
- **Green PRs auto-merge.** A PR that passes ALL required checks (§4) and the
  self-review gate (§5) is merged by the agent. Anything red stays open and the
  agent moves on (never force-merge, never disable a check).
- **Wave-ordered.** Agents pick from the current wave (README "Sequencing"),
  lowest number first, Effort ≤ M, unblocked.

## 2. The loop (each agent repeats until stop conditions)

```
1. SYNC     git fetch origin && git switch main && git pull --ff-only
2. PICK     Open plans/roadmap/README.md. Choose the lowest-numbered plan that is:
              status TODO, in the current wave, unblocked (deps DONE), Effort ≤ M,
              and NOT owned by another agent (claim it: set the row to
              "IN PROGRESS (agent <id>)" in a tiny commit on main OR via a claim
              file under plans/roadmap/.claims/<n>  — see §6 concurrency).
            If the plan is Effort L → do not implement. SPLIT it first (§3), then loop.
3. DRIFT    Run the plan's drift check if it has one. Re-read the real files it
              names; if code moved, adjust the plan before coding.
4. BRANCH   git switch -c <type>/<area>-<short>   (e.g. feat/advisor-prewhere)
5. BUILD    Implement exactly the plan's Steps. Keep it declarative; honor STOP
              conditions and the invariants (§8). Add the plan's "Real test".
6. VERIFY   Run the local gate (§4). Must be green. If not, fix or STOP the plan
              (set row to BLOCKED with a one-line reason) and move on.
7. PR       Conventional-commit title; body links the plan + "Closes"/refs; fill
              the PR template. Push, open PR, enable the required checks.
8. WATCH    Poll CI: gh pr checks <n> --watch=false (repeat with backoff).
9. MERGE    If ALL required checks pass AND self-review (§5) passes →
              gh pr merge <n> --squash --delete-branch. Else leave open, comment
              why, set row to IN REVIEW or BLOCKED.
10. TRACK   Update the plan's status row in README.md (DONE / IN REVIEW / BLOCKED).
              Append a one-line entry to §9 Nightly log.
11. LOOP    Back to step 1.
```

## 3. Splitting an `L` plan (mandatory before implementing)

An `L` plan is a mini-epic. The agent:
1. Reads the plan's Steps (they are already agent-sized units).
2. Creates child rows `NN.a`, `NN.b`, … in README.md, each Effort ≤ M, with
   `Depends on` set so they serialize correctly.
3. Sets the parent row to `IN PROGRESS` and implements children one PR each.
4. Parent → `DONE` only when all children are `DONE`.

Never open one giant PR for an `L` plan.

## 4. Required local + CI gate (must be green to merge)

Local (run before pushing — matches CI):
```
bun install --frozen-lockfile
bun run lint            # Biome
bun run build           # Vite build + tsc --noEmit (type check)
bun run test:unit       # targeted unit suites (+ the plan's new test)
bun run depcruise       # dependency boundaries (no cycles, packages !-> apps)
```
When the change touches the worker/bundle:
```
cd apps/dashboard && bun wrangler deploy --minify --dry-run   # worker size sanity
```
CI required checks (GitHub Actions) that must pass for auto-merge:
- `ci.yml` (lint + type + test), `test.yml` (unit + e2e smoke), `cloudflare.yml`
  (build + dry-run deploy), `a11y.yml`, `bundle-size.yml`.
- If a plan makes `bundle-size` or `a11y` a *blocking* gate (Plan 15), respect it.

**Rule:** never merge with a failing or skipped required check. Never edit a
workflow to make a check pass. Fixing flaky e2e = re-run once; if still red, treat
as BLOCKED, not merge.

## 5. Self-review gate (before auto-merge)

The agent must be able to answer YES to all, in the PR body:
- [ ] The plan's **Real test fails on main and passes on this branch** (paste the
      before/after run).
- [ ] No **core monitoring** feature was gated behind cloud mode (self-hosted
      whole).
- [ ] Behaviour is **fail-closed to OSS** (unset/junk env → OSS defaults).
- [ ] No **destructive/DDL auto-apply** by the agent; recommendations only.
- [ ] No secrets added to committed `.env*`; no `[vars]` re-added to `wrangler.toml`.
- [ ] Docs updated in the same PR if user-facing (esp. `docs/content/ai-agent.mdx`,
      `.env.example`, pricing/plan copy).
- [ ] Diff is scoped to the plan; no drive-by refactors.

If any box is NO → do not auto-merge; leave `IN REVIEW` for a human.

## 6. Concurrency (multiple agents, no collisions)

- **Claim before work.** An agent claims a plan by setting its README row to
  `IN PROGRESS (agent <id>)` in a 1-line commit to `main` (rebased), or by
  creating `plans/roadmap/.claims/<n>.claim` containing its id + timestamp.
  Before claiming, `git pull --ff-only` and re-check the row is still `TODO`.
- **One plan per agent at a time.**
- **Stale claim reclaim:** a claim older than 3h with no open PR may be reclaimed.
- **Merge queue:** if two PRs touch overlapping files, the second rebases on main
  and re-runs the gate before merging. Never merge on top of an unrebased branch.
- **Serialize hot files.** Plans touching `packages/pricing/src/plans.ts`,
  `lib/billing/plan-enforcement.ts`, or `README.md` should not run in parallel —
  give billing plans (13/01) a single owner for the night.

## 7. Ready-to-paste launch prompt

Paste this into Claude Code (or run per-agent in a swarm). It is self-contained.

```
You are an autonomous engineering agent on the chmonitor repo
(github.com/chmonitor/chmonitor). Work the 2026-H2 roadmap OVERNIGHT, unattended,
and AUTO-MERGE your own green PRs. Optimize for: revenue, adoption, AI depth.

READ FIRST (in order):
  plans/roadmap/README.md            (the tracker — your work queue)
  plans/roadmap/00-vision-and-strategy.md
  plans/roadmap/99-overnight-swarm-runbook.md   (your operating contract — obey it)
  CLAUDE.md and AGENTS.md            (conventions, commands, invariants)

LOOP (repeat until STOP):
  1. git fetch origin && git switch main && git pull --ff-only
  2. Pick the lowest-numbered plan in the current wave that is TODO, unblocked,
     Effort <= M, unclaimed. Claim it (set its README row to "IN PROGRESS
     (agent <you>)", pull --ff-only first). If Effort L, split it into <=M child
     rows and implement children instead (runbook §3).
  3. Run the plan's drift check; re-read the real files it names.
  4. Branch: <type>/<area>-<short>. Implement EXACTLY the plan's Steps. Add its
     "Real test" (it must fail on main, pass on your branch). Keep logic
     declarative. Honor the plan's STOP conditions and the invariants below.
  5. Gate (all must be green):
       bun install --frozen-lockfile
       bun run lint && bun run build && bun run test:unit && bun run depcruise
     (+ `cd apps/dashboard && bun wrangler deploy --minify --dry-run` if worker/bundle touched)
  6. Open a PR (conventional-commit title; body links the plan, pastes the
     before/after test run, and completes the self-review checklist in runbook §5).
  7. Watch CI: `gh pr checks <n> --watch=false` with backoff. If ALL required
     checks pass AND every self-review box is YES →
       `gh pr merge <n> --squash --delete-branch`
     Else leave it open, comment why, set the README row to IN REVIEW or BLOCKED.
  8. Update the plan's README status row and append one line to the Nightly log
     (runbook §9). Loop.

INVARIANTS (never violate — if a plan would, STOP that plan and mark BLOCKED):
  - Self-hosted stays whole: never gate a core monitoring feature behind cloud mode.
  - Fail-closed to OSS: unset/junk CHM_*/VITE_* env resolves to OSS/non-cloud.
  - The AI agent RECOMMENDS DDL, never auto-applies destructive changes.
  - Never enforce a paywall gate whose feature isn't built (honesty invariant).
  - No secrets in committed .env*; never re-add [vars] to wrangler.toml.
  - Don't edit CI workflows to make a check pass. Don't merge anything red/skipped.
  - Scope each PR to one plan; no drive-by refactors.

STOP when: no eligible TODO plan remains in the current wave; OR you hit the same
CI failure 3× on one plan (mark BLOCKED, move on); OR a change would require a
secret/credential/human decision (mark BLOCKED with the question). Then post a
summary of merged PRs, blocked plans (+reasons), and updated tracker state.
```

## 8. Guardrails / invariants (canonical list)

1. **Self-hosted stays whole** — no core monitoring feature behind cloud mode.
2. **Fail-closed to OSS** — bad/unset env → OSS defaults; cloud is additive.
3. **Recommend, never auto-apply** — the agent/advisor never runs destructive DDL.
4. **Honest paywalls** — never flip a `deferred` gate to `enforced` unless the
   feature is built + tested.
5. **ClickHouse-version-safe** — new `system.*` queries degrade gracefully on old
   versions / missing tables (use the existing validation + graceful-error patterns).
6. **No query-load surprises** — prefer `asynchronous_metric_log`/cached reads;
   don't put a live `query_log` scan on a fast poll timer.
7. **Secrets discipline** — secrets only via `scripts/set-secrets.ts` / K8s Secret
   / `.env.local`; never committed; never a `[vars]` block in `wrangler.toml`.
8. **Docs-in-sync** — agent tool/skill/env changes update `docs/content/ai-agent.mdx`
   in the same PR.
9. **Conventional commits** — commitlint is enforced (`type(scope): subject`).

## 9. Nightly log (agents append; humans skim in the morning)

Format: `- <ISO time> · plan <n> · <PR #/status> · <one line>`

<!-- agents append below this line -->
