# 00 — Vision & Strategy (2026 H2)

> Planned at commit `ab4c34426`, 2026-07-02. Grounded in the product audit and
> market research in [`02-research-appendix.md`](02-research-appendix.md).

## 1. What chmonitor is (one paragraph)

chmonitor is the **open-source-first monitoring and ops brain for ClickHouse**.
It reads `system.*` tables and turns them into (a) a fast, batteries-included
dashboard, (b) an **AI ops agent** that explains *why your cluster is unhealthy
and what to change*, and (c) an **MCP server** so any coding agent (Claude,
Cursor) can pull ClickHouse ops context. It runs **everywhere ClickHouse runs** —
self-hosted, Kubernetes, bare metal, Altinity, Aiven, and ClickHouse Cloud — from
one Docker container or a hosted Cloud plan.

## 2. Why we win — the wedge

The market research is unambiguous about the opening (evidence in the appendix):

- **There is no "pganalyze for ClickHouse."** pganalyze built a real business
  ($149–$399/mo/server) on Postgres *advisors* — index/query/vacuum
  recommendations that turn raw metrics into "here's the fix." Nobody ships the
  ClickHouse equivalent: a **projection / skip-index / partition-key /
  primary-key-ordering / materialized-view advisor** driven by `system.query_log`
  + parts/merges data. **This is our single clearest wedge** (Plan 21).
- **ClickHouse's own AI is Cloud-locked and analytics-first.** ClickHouse
  Agents (Claude-powered, built on the LibreChat they acquired), Ask AI, the
  remote MCP, ClickStack agentic observability, and `clickhousectl` agents are
  *all* bound to ClickHouse **Cloud** and mostly aimed at *analysts asking
  business questions* — not *SREs/DBAs fixing merges, mutations, replication lag,
  and disk pressure on self-managed clusters*. The entire self-hosted / BYOC /
  on-prem population gets none of it. **We own the surface they structurally
  won't serve.**
- **Grafana/Altinity are dashboards, not products.** They render panels; they
  don't diagnose. They require you to stand up Grafana + Prometheus. We are
  instant value with zero scaffolding and semantic understanding of CH internals.
- **We already have distribution and credibility.** ClickHouse's own docs cite
  `duyet/clickhouse-monitoring` under community monitoring solutions. That is a
  standing top-of-funnel we under-exploit today.

**Three defensible moats, in order:** (1) ClickHouse-specific *advisor* depth,
(2) works-everywhere / self-host / multi-cluster fleet view, (3) open-source
trust + community.

## 3. Core values (what we will not trade away)

1. **Self-hosted stays whole.** Never gate a core monitoring feature behind
   cloud mode. Cloud is *additive* (demo hosts, per-user storage, billing). This
   is already an enforced invariant (`lib/cloud`, `lib/edition`, fail-closed) —
   keep it.
2. **Truly open source, less hard-coded logic.** The project instruction is
   explicit: make the codebase genuinely open and drive behaviour from data, not
   hard-coded branches. Every advisor rule, alert rule, chart, and query-config
   should be **declarative and contributor-editable** (extend the existing
   query-config + alerting registries), so the community can add coverage without
   touching core.
3. **Fast and professional.** Static-first render, CDN-cached, no query load
   surprises on the user's cluster. Speed is a feature (Plan 15).
4. **Honest paywalls.** Advertised benefits are either enforced or visibly marked
   "not yet enforced" with a test (the existing `plan-enforcement` registry).
   We never silently sell vapor.
5. **Agent-native.** Every capability should be reachable by an AI agent (our
   own and third-party) via MCP, because ClickHouse itself is betting the
   ecosystem goes agent-first ("agent-facing analytics").

## 4. Who it's for (personas, in priority)

1. **Self-hosting ClickHouse SRE/DBA** (homelab → mid-size fleet). Primary. Feels
   the pain ClickHouse Cloud hides. Converts on advisor + alerting + AI.
2. **Teams on managed CH that isn't ClickHouse Cloud** (Altinity, Aiven,
   Tinybird, DoubleCloud) — orphaned by first-party AI. High-value.
3. **ClickStack / SigNoz / observability operators** — run huge CH clusters to
   store telemetry; need to monitor *the cluster itself*. A distribution wedge.
4. **ClickHouse Cloud users** who want cross-service fleet view, BYOK, or ops
   depth Cloud abstracts away. Secondary but strategically useful.

## 5. North star & 6-month targets

Priority order chosen by the owner: **Revenue + Adoption + AI differentiation**
(acquisition-readiness is the by-product, not the primary lever).

| Metric | Now (baseline TODO) | 3-month | 6-month |
|--------|--------------------|---------|---------|
| Cloud MRR | ~$0 | $1k | $5k |
| Paying accounts | 0 | 15 | 60 |
| Self-host installs (telemetry pings) | measure first | +50% | +200% |
| GitHub stars | measure first | +25% | +75% |
| X/Twitter followers | measure first | 2× | 4× |
| AI investigations/week | measure first | — | primary retention signal |

**Action:** the first swarm task in Wave 1 is to instrument and surface these
baselines (telemetry already exists; add a private founder dashboard — Plan 20).

## 6. The ClickHouse-acquisition thesis (secondary, do-not-optimize-for)

ClickHouse buys adjacent AI/ops tooling (LibreChat Nov 2025, Langfuse Jan 2026).
To be *acquirable rather than roadkill*, chmonitor should:

- **Own the self-hosted/OSS agent+ops surface** Cloud deliberately doesn't serve —
  the fastest way for ClickHouse to cover the self-managed half of its market.
- **Build on the standards they've bet on:** MCP tools, Claude-default-but-BYOK,
  installable agent skills, LibreChat-compatible artifacts.
- **Be the fleet/multi-cluster ops brain** that complements `clickhousectl` and
  ClickStack rather than competing head-on.
- **Show OSS adoption metrics** (stars, self-host installs, MCP downloads) — the
  exact DNA they praise and acquire.

We do not distort the roadmap for this. Everything that makes us acquirable
(depth, self-host, MCP, community) also makes us independently valuable.

## 7. Strategic decisions (answered)

### 7.1 Should we expand to Postgres (or other DBs)?

**Decision: NO in 2026 H2. Yes to *architecture* readiness, no to *product*
scope.** Rationale:

- Our entire wedge is *ClickHouse-specific depth*. Postgres already has
  pganalyze, pgAnalyze-likes, pgEdge AI DBA, PostgresAI, and every cloud's DBM.
  A shallow multi-DB tool competes with everyone and out-depths no one.
- Depth in CH internals (merges/parts/projections/replication) is what makes the
  advisor and the ops agent valuable and what makes us an acquisition target *for
  ClickHouse specifically*. Diluting that weakens both.
- Multi-DB is a classic focus-killer for a solo/small team. Adoption + revenue in
  the next 6 months come from being the *best* CH tool, not an *okay* everything
  tool.

**What we do instead:** keep the data layer pluggable (it already abstracts a
ClickHouse client; don't hard-code CH assumptions into UI where cheap to avoid),
and record Postgres as a *post-traction* option in Plan 18 behind a clear
trigger ("revisit only after $10k MRR or a concrete design-partner pull"). See
Plan 18 for the ADR.

### 7.2 How do we make users actually pay?

Full plan in [`01-monetization-and-pricing.md`](01-monetization-and-pricing.md).
Summary: keep the market-validated **$29 Pro / $99 Max** anchors; add a
**per-host meter** above tier caps for fleet expansion revenue; monetize the AI
agent with **included investigations + 2–3× overage + BYOK escape valve**; gate
the standard **SSO/RBAC/audit** bundle at Enterprise. Flip the `deferred`
enforcement flags to `enforced` at a dated GA, grandfathering early-access users.

### 7.3 Do we compete with ClickHouse's AI or complement it?

**Complement in public, differentiate in substance.** Publicly ride their
"open, MCP-everywhere, bring-your-own-agent" thesis (ship an MCP; be a great
context provider). Substantively, aim our agent at **ops/DBA** questions on
**self-hosted/fleet** clusters — the persona and surface they don't cover.

### 7.4 Better UI / better landing / better design / faster / more AI / easier SDK / easier API / more server tools — which first?

Ranked by leverage on the north star:
1. **The advisor + ops agent** (differentiation that also drives conversion) — Plans 21, 10.
2. **Landing + paywall** (turn existing traffic into money) — Plans 14, 13.
3. **Growth/distribution incl. X** (more traffic into the funnel) — Plan 20.
4. **MCP/server tools** (moat + ecosystem + acquisition-fit) — Plan 11.
5. **Ingestion analytics + alerts/webhooks** (retention, felt painpoints) — Plans 12, 19.
6. **Performance + onboarding** (quality/adoption) — Plans 15, 16.
7. **SDK/public API + more platforms** (ecosystem/reach) — Plans 17, 18.

## 8. Open questions we are deliberately tracking (self-interrogation)

These are honest unknowns. Each has an owner-action or an experiment, not a guess.

1. **What is the *one* painpoint that makes an SRE install us on a Friday night?**
   Hypothesis: "my merges/mutations are stuck / disk is filling and I don't know
   why." → Validate via the advisor's first three rules + 5 user interviews (Plan 16).
2. **Will people pay for AI ops, or only for dashboards + alerting?** → The AI
   credit-cap A/B in Plan 13 answers this directly.
3. **Is per-host or per-seat the right expansion meter for CH?** → A/B in Plan 13.
4. **Does BYOK cannibalize revenue or expand the top of funnel?** → Offer BYOK on
   Free/Pro, measure conversion vs. included-credits cohort.
5. **Can the advisor produce recommendations good enough to trust?** → Ship
   read-only "suggested, not applied" recommendations first; measure
   accept/dismiss; never auto-apply DDL (Plan 21 STOP condition).
6. **Is the acquisition angle a distraction?** → Treat as by-product; re-review at
   3 months only if it starts shaping tradeoffs.
7. **What actually moves X/Twitter followers for a CH dev-tool?** → Build-in-public
   cadence + benchmark/teardown content + the "cited by ClickHouse docs" proof
   (Plan 20); measure per-format engagement.

## 9. What we will NOT do (anti-scope, 2026 H2)

- No general multi-DB product (see 7.1).
- No auto-applying destructive DDL from the agent (recommend only).
- No breaking the OSS build to sell Cloud.
- No new frontend framework rewrite (v0.3 TanStack Start migration is done).
- No feature we can't gate honestly and test.

## 10. Success looks like (6 months out)

A self-hosting ClickHouse team finds chmonitor (docs link / X / search), runs one
Docker command, gets an **advisor report and an AI ops chat** that immediately
tells them something true and useful about their cluster, hits a tasteful paywall
for retention/alerting/AI headroom, and pays $29–$99/mo — while a growing OSS
community adds advisor rules and charts, and ClickHouse notices the self-hosted
ops surface we own.
