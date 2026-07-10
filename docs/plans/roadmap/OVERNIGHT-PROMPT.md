# Overnight Autonomous Swarm — Plan & Ready-to-Schedule Prompt

> Single source for running the chmonitor roadmap unattended overnight, with
> **auto-merge of green PRs**. Supersedes the command/path details in
> `99-overnight-swarm-runbook.md` and `plans/OVERNIGHT-SWARM.md` where they
> disagree (those predate the pnpm migration and use stale `bun install` / wrong
> tracker paths). Refreshed 2026-07-10.

---

## 0. Core value & vision (reviewed — still holds)

**One sentence:** chmonitor is the open-source *"pganalyze for ClickHouse"* — it
reads your `system.*` tables and tells you exactly what to fix (projections, skip
indexes, partition keys, PREWHERE, materialized views, merge/mutation pressure)
on **every** deployment (self-host, K8s, Altinity, Aiven, Cloud), with an AI ops
agent and an MCP server so any coding agent can pull ClickHouse ops context.

**North star (priority order):** Revenue/MRR → Adoption → AI differentiation.
ClickHouse acquisition-readiness is a by-product, not a lever.

**Values we never trade away:** (1) self-hosted stays whole / fail-closed to OSS;
(2) truly open-source, less hard-coded logic (advisor/alert/chart/query rules stay
declarative + contributor-editable); (3) fast & professional, no query-load
surprises; (4) honest paywalls (advertised ⟺ enforced, or visibly `deferred` with
a test); (5) agent-native (every capability reachable via MCP).

No change to the strategy this pass — it's confirmed by the July-2026 market
research (`docs/internal/2026h2-market/`). The only thing that needed fixing is the
**execution machinery**: the runbooks told agents to use `bun install` (the repo
enforces `only-allow pnpm`, so that fails on step 1) and pointed at
`plans/roadmap/README.md` (the tracker actually lives at
`docs/plans/roadmap/README.md`). Both are corrected below.

---

## 1. The plan (what the swarm does tonight)

1. **Work the canonical queue.** `docs/plans/roadmap/README.md` is the single
   work queue and tracker. The granular `plans/NN-*.md` files are the detailed
   **appendix** that fleshes out each wave — read the matching plan file for exact
   Steps/Real-test/STOP, but the *status of record* lives in the roadmap README.
2. **Keep the docs fresh (housekeeping, do this continuously).** When a plan is
   already implemented/merged, it should not linger as open work:
   - In the tracker, mark it `DONE (#PR)` — do not leave it `TODO`.
   - **Remove the already-implemented granular spec file** `plans/NN-*.md` in the
     same PR that records it DONE (its history is preserved in git + the PR link).
     Keep a one-line `NN → #PR` entry in the "Shipped" list so nothing is lost.
   - Never delete a plan that is `HELD`, `IN REVIEW`, `BLOCKED`, or in-flight.
3. **Fix the known bugs first** (found in the 2026-07-10 audit — §4).
4. **Then advance the wave** (Wave 1 first): lowest-numbered `TODO`, unblocked,
   Effort ≤ M. Split any `L` plan into ≤ M children before implementing.
5. **Auto-merge green PRs**; leave anything red/ambiguous open for a human.

---

## 2. The correct local + CI gate (pnpm, with bun as the test runner)

The repo uses **pnpm** (enforced by `preinstall: only-allow pnpm` — `bun install`
/ `npm install` are rejected). Unit tests run on **`bun test`**, invoked through the
pnpm scripts. Run, in order, and require green before opening a PR:

```bash
pnpm install --frozen-lockfile
pnpm run lint            # biome lint .
pnpm run type-check      # turbo -> tsc --noEmit
pnpm run build           # turbo -> vite build
pnpm run test:unit       # -> cd apps/dashboard && bun test src/ --isolate
pnpm run test:packages   # -> bun test packages --isolate   (if packages/ touched)
pnpm run depcruise       # dependency boundaries (no cycles; packages !-> apps)
```

When the change touches the worker/bundle:

```bash
cd apps/dashboard && pnpm run cf:deploy -- --dry-run   # worker size sanity (do NOT deploy)
```

For a **single targeted suite**, call bun directly, e.g.
`cd apps/dashboard && bun test src/lib/health/ --isolate`.

CI required checks that must pass for auto-merge: `ci.yml` (build + lint +
depcruise), `test.yml` (unit + e2e smoke), `cloudflare.yml` (build + dry-run),
`a11y.yml`, `bundle-size.yml`. Never edit a workflow to make a check pass; never
merge a red or skipped required check. A flaky e2e may be re-run once; still red →
treat as BLOCKED, not merge.

---

## 3. Invariants (never violate — if a plan would, STOP it and mark BLOCKED)

- **Self-hosted stays whole:** never gate a core monitoring feature behind cloud
  mode.
- **Fail-closed to OSS:** unset/junk `CHM_*` / `VITE_*` env resolves to
  OSS/non-cloud defaults; cloud is additive.
- **Advisor recommends, never applies:** the AI/advisor emits ranked DDL + risk +
  impact and never executes/mutates analyzed queries. Every advisor PR includes a
  test asserting no execution.
- **Honest paywalls:** never flip a `deferred` gate to `enforced` unless the
  feature is built + tested; landing/marketing claims must match shipped+enforced
  code.
- **ClickHouse-version-safe:** new `system.*` queries degrade gracefully on old
  versions / missing tables.
- **No query-load surprises:** prefer cached/async metric reads; no live
  `query_log` scan on a fast poll timer.
- **Secrets discipline:** secrets only via `scripts/set-secrets.ts` / K8s Secret /
  `.env.local`; never committed; never a `[vars]` block in `wrangler.toml`.
- **Postgres/multi-DB = NO** for 2026 H2.
- **Scope each PR to one plan; conventional commits** (commitlint enforced).
- **Any auth / billing / security-surface change → request human review, do not
  auto-merge.**

---

## 4. Known bugs to fix first (from the 2026-07-10 audit)

1. **[HIGH] SSRF re-validation gap on alert delivery.**
   `apps/dashboard/src/lib/health/server-sweep.ts` — `postWebhook()` (and the
   fixed-URL `postPagerDutyEvent()`) fetch operator-configured route URLs with a
   **bare `fetch`** and no SSRF re-check. Route URLs are validated only at
   create-time (`routes/api/v1/health/routes.ts`), and the comment there claiming
   "delivery re-validates via the sweep's postWebhook" is **false**. A registered
   route can DNS-rebind to `169.254.169.254`/internal hosts before the cron sweep
   POSTs to it. **Fix:** call `validateHostUrl(url)` (from
   `@/lib/browser-connections/host-url`) at the top of `postWebhook`, mirroring
   `opsgenie-dispatch.ts`; return `{ ok:false, error }` if unsafe; correct the
   false comment. Add a test asserting an internal-target route is blocked at
   delivery. *(Security-surface → land as its own PR, request human review.)*
2. **[LOW] Free "$0.50 AI budget" is advertised `enforced` but unreachable.**
   `packages/pricing/src/plans.ts` sets Free `aiMonthlyUsdBudget: 0.5` and
   `plan-enforcement.ts` marks it `enforced`, but `meterAiOverage()`
   (`ai-usage-store.ts`) returns early when `plan.aiOverage == null` (Free), so
   Free spend is never metered. **Fix (honesty invariant):** set Free
   `aiMonthlyUsdBudget: null` (the daily 5-msg cap is the real bound) **or** meter
   Free spend independently. Update the parity test.
3. **[LOW] Clerk seat webhook counts one 100-row page, not the total.**
   `routes/api/v1/webhooks/clerk.ts` uses `memberships.data.length` from a
   `limit: 100` list. Latent under-count if a finite seat tier > 100 is ever added.
   **Fix:** use `memberships.totalCount`.

---

## 5. READY-TO-SCHEDULE PROMPT (paste this verbatim)

```
You are an autonomous engineering agent on the chmonitor repo
(github.com/chmonitor/chmonitor). Work the 2026-H2 roadmap OVERNIGHT, unattended,
and AUTO-MERGE your own green PRs. Optimize for: revenue, adoption, AI depth.

PACKAGE MANAGER: pnpm (enforced by only-allow pnpm — bun/npm install are REJECTED).
Unit tests run on `bun test` but are invoked through pnpm scripts. Never run
`bun install`.

READ FIRST (in order):
  docs/plans/roadmap/README.md               (THE tracker — your work queue)
  docs/plans/roadmap/00-vision-and-strategy.md
  docs/plans/roadmap/OVERNIGHT-PROMPT.md      (this contract — obey §2/§3/§4)
  CLAUDE.md and AGENTS.md                     (conventions, commands, invariants)
The granular specs are the appendix: plans/NN-*.md (Steps/Real-test/STOP). The
STATUS OF RECORD is docs/plans/roadmap/README.md.

FIRST, fix these known bugs (own PR each; the SSRF one needs human review):
  1. [HIGH] SSRF: add validateHostUrl(url) to postWebhook() in
     apps/dashboard/src/lib/health/server-sweep.ts (mirror opsgenie-dispatch.ts);
     fix the false "re-validates on send" comment in routes/api/v1/health/routes.ts;
     add a delivery-blocks-internal-target test.
  2. [LOW] Free aiMonthlyUsdBudget: make it honest (null, or meter Free spend);
     update the plan-enforcement parity test.
  3. [LOW] Clerk seat webhook: use memberships.totalCount, not data.length.

THEN loop (repeat until STOP):
  1. git fetch origin && git switch main && git pull --ff-only
  2. Pick the lowest-numbered plan in the current wave that is TODO, unblocked,
     Effort <= M, unclaimed. Claim it (set its README row to "IN PROGRESS
     (agent <you>)"; pull --ff-only first). If Effort L, split into <=M child rows
     and implement children instead.
  3. Run the plan's drift check; re-read the real files it names. If the repo has
     drifted or the plan is already implemented, DO NOT re-implement — instead mark
     it DONE(#PR) in the tracker and REMOVE the stale plans/NN-*.md spec file in a
     small housekeeping PR (keep a one-line "NN -> #PR" entry under Shipped). Never
     remove a HELD / IN REVIEW / BLOCKED / in-flight plan.
  4. Branch: <type>/<area>-<short>. Implement EXACTLY the plan's Steps. Add its
     "Real test" (must fail on main, pass on your branch). Keep logic declarative.
     Honor the plan's STOP conditions and the invariants below.
  5. Gate (all green before PR):
       pnpm install --frozen-lockfile
       pnpm run lint && pnpm run type-check && pnpm run build
       pnpm run test:unit        (+ pnpm run test:packages if packages/ touched)
       pnpm run depcruise
     (+ `cd apps/dashboard && pnpm run cf:deploy -- --dry-run` if worker/bundle touched)
  6. Open a PR (conventional-commit title; body links the plan, pastes the
     before/after test run, completes the self-review checklist).
  7. Watch CI: `gh pr checks <n> --watch=false` with backoff. AUTO-MERGE only if
     ALL required checks pass AND no invariant is touched unsafely
     (auth/billing/security-surface -> request human review instead):
       gh pr merge <n> --squash --delete-branch
     Else leave open, comment why, set the README row to IN REVIEW or BLOCKED.
  8. Update the plan's README status row; if it shipped, remove its plans/NN-*.md
     spec file per step 3. Append one line to the Nightly log. Loop.

WAVE ORDER: Wave 1 first — 21 (advisor), 10 (ops agent), 13 (paywall GA),
14 (landing/conversion), 20 (growth/X). Then Wave 2 (11, 12, 19, 16, 15), then
Wave 3 (17, 18, enterprise SSO/RBAC).

INVARIANTS (never violate — if a plan would, STOP it and mark BLOCKED):
  - Self-hosted stays whole: never gate a core monitoring feature behind cloud mode.
  - Fail-closed to OSS: unset/junk CHM_*/VITE_* env -> OSS/non-cloud defaults.
  - Advisor RECOMMENDS DDL, never auto-applies; destructive actions stay ACK-gated.
  - Honest paywalls: don't flip deferred->enforced unless built+tested; landing
    claims match shipped code.
  - ClickHouse-version-safe system.* queries; no live query_log scan on a fast timer.
  - No secrets in committed .env*; never re-add [vars] to wrangler.toml.
  - Postgres/multi-DB = NO for 2026 H2.
  - Don't edit CI workflows to make a check pass. Don't merge red/skipped. One plan
    per PR; no drive-by refactors. Conventional commits.
  - Any auth/billing/security change -> human review, do not auto-merge.

STOP when: no eligible TODO plan remains in the current wave; OR the same CI failure
hits 3x on one plan (mark BLOCKED, move on); OR a change needs a
secret/credential/human decision (mark BLOCKED with the question). Then post a
summary: merged PRs, plans marked DONE + spec files removed, blocked plans (+why),
and the updated tracker state.
```

---

## 6. How to schedule it

- **Cron / CI runner:** run the §5 prompt through Claude Code on a nightly cron
  (e.g. `0 22 * * *`) on an authenticated machine with `gh` logged in and push
  rights. Parallelism: start conservative (N = 4–6 agents), each in its own git
  worktree/branch.
- **Scheduled task (Cowork):** ask to "run the overnight swarm every night at
  10pm" and this prompt becomes the task body.
- **Prerequisites:** `gh` authenticated; pnpm + bun installed; branch protection
  configured so required checks actually gate merges (the auto-merge safety net).
