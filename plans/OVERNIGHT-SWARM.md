# Overnight swarm — kickoff prompts (Round 3, plans 14–70)

Three ways to run the Round-3 backlog:
1. **Master swarm prompt** — one prompt that dispatches parallel agents across the whole backlog,
   auto-merges green PRs, and reports back.
2. **Priority-wave prompts** — run a wave at a time (R → E/A/I/AI → D → G).
3. **Per-plan prompts** — every `plans/NN-*.md` file has a `## Kickoff prompt` block to run that
   one plan on demand.

**Invariants every agent must hold (non-negotiable):**
- Self-hosted/OSS stays whole; every plan/billing gate **fails open** without Clerk.
- AI/advisor **recommends** DDL and **never auto-applies**; destructive actions stay ACK-gated.
- **Honest paywalls & marketing**: advertised ⟺ enforced (or explicitly `deferred` in
  `lib/billing/plan-enforcement.ts`); landing claims match shipped code.
- Postgres/multi-DB: **NO** for 2026 H2.
- Tests: **Bun test** for unit/logic, **Cypress** for component/e2e. Do **not** add Jest.

**Verification baseline (every plan):** `bun run type-check` · `bun run build` · targeted
`bun test … --isolate` · `bun run lint` (Biome). Landing plans: `cd apps/landing && bun install
--frozen-lockfile && bun run build`.

**Dependency edges to respect:** 54→53, 55→53, 58→53 · 57→56 · 59→56,57 · 34→30 · 47/48/49/50→
build on 46's advisor dir but can start independently · 52→25/37 (deliver-or-persist) ·
61/63→verify against shipped features · 65 gates 60's "live demo" CTA.

---

## 1. Master swarm prompt (auto-merge green)

```text
You are the overnight build swarm for the chmonitor monorepo (repo root: the chmonitor/ checkout).
Goal: work the Round-3 feature backlog in plans/14–70 to green, merged PRs, unattended.

Setup:
1. Read plans/ROADMAP-2026H2.md (strategy + per-plan specs) and plans/README.md (status table +
   conventions). Read CLAUDE.md and AGENTS.md for repo rules.
2. Treat plans/README.md as the work queue: a plan is available if its row is TODO and its
   "Depends on" plans are DONE. Respect the dependency edges in plans/OVERNIGHT-SWARM.md.

Execution loop (run up to N plans in parallel, each in its own git worktree/branch):
1. Claim a plan: set its README row to IN PROGRESS (your agent id) and commit that on your branch.
2. Open plans/NN-*.md and implement EXACTLY what it scopes — nothing more. Honor its STOP
   conditions and drift check. If the repo has drifted from the spec (a file moved/renamed), adapt
   to reality; if the plan is no longer valid, set the row to BLOCKED (one-line reason) and stop.
3. Hold the invariants (self-hosted whole / fail-open; advisor recommends-never-applies; honest
   paywalls+marketing; Bun test not Jest; Postgres=NO).
4. Run the plan's Verification block. All must pass: type-check, build, targeted bun test, lint.
5. Open a PR titled `feat(<area>): <plan title> (plan NN)` with a body linking plans/NN-*.md and a
   filled checklist of the plan's Done criteria.
6. AUTO-MERGE if and only if: CI is green, no merge conflicts, and no invariant is touched
   unsafely (any auth/billing/security-surface change → request human review instead of
   auto-merging). Squash-merge. Then set the README row to DONE with the merge SHA.
7. If anything fails: leave the row IN PROGRESS with a one-line blocker note, push the branch, and
   continue to the next plan. Never force-push main. Never merge red.

Ordering: prefer P0 → P1 → P2, and within that the owner's focus waves in order
Revenue(14–20) → Alerting(25–34) → Integrations(35–45) → Advisor(46–52) → Enterprise(21–24) →
Dashboards/OSS(53–59) → Growth(60–70). Test-only/additive plans (17, 51) may run anytime.

Report at the end: a table of plan → status → PR/SHA → notes, and any BLOCKED plans with reasons.
Do NOT touch secrets, do NOT deploy, do NOT change pricing numbers or remove any existing feature.
```

Tune `N` (parallelism) to your runner. Start conservative (N=4–6).

---

## 2. Priority-wave prompts

Run one wave per night (or per runner). Each wave prompt is the master loop, scoped to a plan
range. Paste the master prompt above, then append the wave scope:

**Wave R — Revenue now (14–20)**
```text
SCOPE: only plans 14–20 (Revenue). These unblock the first paid dollar: AI-overage metering (14),
paywall UX (15), billing dashboard card (16), checkout/webhook tests (17), per-host overage (18),
downgrade protection (19), seat gate (20). Extra care on 14/18: never bill self-host, never
double-charge; classify anything unshippable as `deferred` in plan-enforcement rather than faking
revenue. Any billing-surface change → human review, do not auto-merge.
```

**Wave A — Alerting (25–34)** — *owner focus*
```text
SCOPE: only plans 25–34 (Alerting & Incident). Land 25 (email) and 27 (alert history) first; 28,
29, 33 record into 27's alert_events (fall back gracefully if 27 not merged). 34 extends 30's
alert_routes — land 30 before 34. Remediation (33) stays ACK-gated, never auto-executes DDL. All
new outbound calls reuse the SSRF-guarded fetch.
```

**Wave I — Integrations (35–45)** — *owner focus*
```text
SCOPE: only plans 35–45 (Integrations). Adoption flywheels first: 35 (Prometheus /metrics), 41
(ClickHouse Cloud connect), 43 (MCP registry), 44 (outbound webhook bus). 38 (Grafana plugin) and
40 (Terraform provider) bootstrap NEW packages with their own toolchains — they must NOT break the
monorepo `bun run build`; open them as separate PRs and request human review before merge. 36 adds
a Cloudflare Queues binding to wrangler.toml with a self-host fail-open path.
```

**Wave AI — Advisor wedge (46–52)** — *highest strategic value*
```text
SCOPE: only plans 46–52 (Advisor). 46 (query-advisor-engine) is the wedge — build the advisor dir
+ tool; 47/49/50 extend it; 48 (baselines) and 51 (agent-eval goldens) are independently landable.
ABSOLUTE invariant: the advisor OUTPUTS ranked DDL + risk + impact and NEVER executes/auto-applies.
Every advisor PR must include a test asserting no execution/mutation of analyzed queries. Meter
advisor calls as AI usage (ties to 14).
```

**Wave E — Enterprise (21–24)**
```text
SCOPE: only plans 21–24 (Enterprise: SSO/SAML, audit-log export, RBAC, multi-org pooling). All are
edition-gated and must NOT degrade the OSS/community build (fail-open to community all-access).
Auth/RBAC/audit changes → human review, do not auto-merge. Prefer Clerk enterprise connections for
SSO rather than a bespoke SAML stack.
```

**Wave D — Dashboards & OSS de-hardcoding (53–59)**
```text
SCOPE: only plans 53–59. Land 53 (activate declarative queries) FIRST — 54, 55, 58 depend on it.
Then 56 (dashboard D1) before 57/59. Keep the TS config path the DEFAULT; declarative + packs must
fail closed to built-ins on any bad input. No feature removal.
```

**Wave G — Landing / Growth (60–70)** — *owner focus ("hero + everywhere")*
```text
SCOPE: only plans 60–70 (Landing/Marketing/Growth). 60 (hero wedge) + 61 (feature sections) + 62
(analytics) + 69 (OG/SEO) are the core refresh; 70 (perf) gates conversion. HARD RULE: verify every
marketing claim against shipped+enforced features before publishing copy — if the advisor (46) or a
channel (email 25 / Opsgenie 26) isn't merged, describe the honest current state, don't oversell.
Analytics (62) respects DNT and captures no PII/secrets. Landing verification:
cd apps/landing && bun install --frozen-lockfile && bun run build.
```

---

## 3. Per-plan prompts

Every `plans/NN-*.md` opens with a `## Kickoff prompt` fenced block scoped to that single plan
(with its invariants + verification commands). Paste it to run one plan on demand — ideal for
spot-fixes or when a wave leaves a plan BLOCKED.
