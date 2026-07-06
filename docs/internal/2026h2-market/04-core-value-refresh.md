# 04 — Core Value Refresh (2026 H2)

> Updates [`docs/plans/roadmap/00-vision-and-strategy.md`](../../plans/roadmap/00-vision-and-strategy.md)
> with verified July-2026 market data from [`01-market-research.md`](01-market-research.md).
> The existing vision is confirmed, not replaced — this sharpens it and adds the
> collection-first billing conclusion. Owner-facing.

## The one-sentence core value

> **chmonitor is the open-source "pganalyze for ClickHouse": it reads your `system.*`
> tables and tells you exactly what to fix — projections, skip indexes, partition keys,
> PREWHERE, materialized values, merge pressure — on every deployment (self-host, K8s,
> Altinity, Cloud), with an AI ops agent and an MCP server so any coding agent can pull
> ClickHouse ops context.**

## What the fresh research confirmed

1. **The wedge is real and unoccupied.** Verified: nobody ships a continuous, scored,
   prescriptive advisor for ClickHouse. Competitors are raw dashboards (Grafana, ch-ui,
   `clickhouse-monitoring`), human consulting (Altinity), reactive LLM chat (Cloud Ask
   AI), or preview-grade telemetry (Datadog DBM is *preview-only* for ClickHouse as of
   July 2026). This validates the single clearest bet.

2. **The pains are tuning problems, not bugs — which is exactly what an advisor
   monetizes.** Verified operator pains: too-many-parts, MEMORY_LIMIT_EXCEEDED, merge
   storms, expensive mutations, roll-your-own alerting, ClickHouse Cloud cost anxiety.
   Every one maps to an advisor rule.

3. **Pricing is well-anchored.** $29/$99 undercuts pganalyze ($149/$399) ~5× and Datadog
   DBM (~$70/host). Approve the anchors; the work is *collection*, not price.

4. **The MCP server is a distribution channel, not just a feature** — competitor-free
   listing surface (MCP Registry, PulseMCP, cursor.directory).

## What changed / sharpened vs the existing vision

| Area | Existing vision | Sharpened by research |
|---|---|---|
| Pricing | "$29/$99 validated" | Confirmed + **add explicit included-host counts** and **replica = 0.5 host** to kill multi-node sticker shock; consider a **$199 Fleet** mid-anchor |
| Billing focus | "turn on the money" | Reframed: **collection is near-zero today** (overage unbilled, 402→JSON, no billing UI). This is *found money* — highest ROI in the roadmap |
| BYOK | "offer on Free/Pro" | Confirmed as a **2026 expectation** (JetBrains, Copilot Jan 2026) — lead with it on the AI advisor |
| Competitive threat | "Cloud AI is analytics-first" | Confirmed, but **Cloud native advisor is the #1 threat to watch** — our moat is the self-hosted/Altinity/BYOC surface + fleet view |
| SEO | Wave G exists | Now **ranked 25 keywords**; build error pages first (thin SERPs), flagship = `system.query_log` slow-query how-to |
| Datadog | competitor | **DBM for ClickHouse is preview-only, rep-gated** — a window, not a wall |

## Core values (unchanged — these we do not trade away)

1. **Self-hosted stays whole.** Cloud is additive; every gate fails open without Clerk.
2. **Truly open source, less hard-coded logic.** Advisor rules, alert rules, charts, and
   query-configs are declarative and contributor-editable. (Directly serves the project
   instruction: "make this codebase truly open source and less hard-code the logic.")
3. **Fast and professional.** Static-first, CDN-cached, no query-load surprises.
4. **Honest paywalls.** Advertised ⟺ enforced (or visibly `deferred` with a test).
5. **Agent-native.** Every capability reachable via MCP.

## North star (unchanged priority order)

**Revenue/MRR → Adoption → AI differentiation.** ClickHouse acquisition-readiness is a
by-product, not a lever. 6-month targets: **$5k MRR, 60 paying accounts, +200% self-host
installs, +75% stars** (baselines to be instrumented first — Plan 62).

## The three moves (confirmed, priority order)

1. **Turn on the money (Wave R).** Collection is broken, not the price. Ship Plans 14–17.
   *Found money.*
2. **Ship the wedge (Wave AI).** The advisor is the reason to pick chmonitor. Ship the
   programmatic DDL recommender (Plans 46–52).
3. **Widen the funnel (Waves A/I/G).** Alerting + integrations + advisor-forward landing +
   SEO engine turn stars into connected clusters into paying accounts.

## Anti-scope (unchanged)

No general multi-DB product (revisit Postgres only after $10k MRR or a design-partner
pull). No auto-applying destructive DDL. No breaking OSS to sell Cloud. No framework
rewrite. No feature we can't gate honestly and test.
