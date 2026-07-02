# chmonitor Roadmap — 2026 H2 (Jul–Dec)

> **This is the master tracker.** It is the single source of truth for the
> 6-month strategy and the queue an autonomous Claude Code swarm works from
> overnight. Every plan file in this folder has a **status row** here. Executors
> (human or agent) update their row when they change state.
>
> Planned at commit `ab4c34426`, 2026-07-02.

## How to read this folder

- **Strategy (why):** [`00-vision-and-strategy.md`](00-vision-and-strategy.md) — vision, values, wedges, north star, the ClickHouse-acquisition thesis, and the hard questions answered.
- **Money (how we get paid):** [`01-monetization-and-pricing.md`](01-monetization-and-pricing.md).
- **Research appendix (evidence):** [`02-research-appendix.md`](02-research-appendix.md) — competitor + ClickHouse-AI + pricing findings the strategy is grounded in. Read this before arguing with a plan.
- **Workstreams (what to build):** the numbered `1x–2x` plan files below. Each follows the repo plan format (Goal → Steps → Real test → Verification → STOP).
- **Overnight execution (who does it while you sleep):** [`99-overnight-swarm-runbook.md`](99-overnight-swarm-runbook.md) — the loop, guardrails, and the ready-to-paste prompt.

## North star (6 months)

Three numbers, in priority order (see strategy doc for the reasoning):

1. **MRR** — first $1k → $5k MRR from Cloud subscriptions + AI usage.
2. **Adoption** — self-hosted installs (telemetry pings) and Cloud sign-ups; GitHub stars; X/Twitter followers.
3. **AI depth** — the ops agent + MCP become the reason people pick chmonitor over Grafana/Altinity and the reason ClickHouse would rather buy than build.

> One-line thesis: **"pganalyze for ClickHouse, open-source-first, that works everywhere ClickHouse runs — with an ops AI agent ClickHouse Cloud structurally won't build for self-hosters."**

## Progress tracker

Status values: `TODO` · `IN PROGRESS` · `IN REVIEW` · `DONE` · `BLOCKED (reason)` · `REJECTED (rationale)`.
Effort: XS (<2h) · S (<1d) · M (1–3d) · L (>3d, must be split before an agent takes it).

| # | Plan | Theme | Priority | Effort | Status |
|---|------|-------|----------|--------|--------|
| 10 | [ai-agent-ops-first.md](10-ai-agent-ops-first.md) | AI moat | P0 | L | TODO |
| 11 | [mcp-and-server-tools.md](11-mcp-and-server-tools.md) | AI moat | P0 | L | TODO |
| 12 | [ingestion-growth-analytics.md](12-ingestion-growth-analytics.md) | Painpoint/feature | P1 | M | TODO |
| 13 | [billing-paywall-ga.md](13-billing-paywall-ga.md) | Revenue | P0 | L | TODO |
| 14 | [landing-design-conversion.md](14-landing-design-conversion.md) | Growth/Revenue | P0 | M | TODO |
| 15 | [performance-and-speed.md](15-performance-and-speed.md) | Quality | P1 | M | TODO |
| 16 | [onboarding-and-painpoints.md](16-onboarding-and-painpoints.md) | Adoption | P1 | M | TODO |
| 17 | [sdk-and-public-api.md](17-sdk-and-public-api.md) | Ecosystem | P2 | L | TODO |
| 18 | [more-platforms-and-databases.md](18-more-platforms-and-databases.md) | Reach | P2 | L | TODO |
| 19 | [alerts-finish-and-webhooks.md](19-alerts-finish-and-webhooks.md) | Painpoint/feature | P1 | M | TODO |
| 20 | [growth-distribution-and-x.md](20-growth-distribution-and-x.md) | Adoption | P0 | M | TODO |
| 21 | [advisor-engine.md](21-advisor-engine.md) | The wedge | P0 | L | TODO |

### Sequencing (what the swarm should pick first)

**Wave 1 (weeks 1–4) — prove the wedge + turn on money.** 21 (advisor), 10 (ops agent), 13 (paywall GA), 14 (landing/conversion), 20 (growth/X).
**Wave 2 (weeks 5–10) — depth + retention.** 11 (MCP tools), 12 (ingestion analytics), 19 (alerts/webhooks), 16 (onboarding), 15 (performance).
**Wave 3 (weeks 11–24) — reach + ecosystem.** 17 (SDK/API), 18 (platforms/DBs), enterprise SSO/RBAC hardening (in 13).

An agent picks the **lowest-numbered `TODO`, unblocked, Effort ≤ M** plan available in the current wave. `L` plans must be split into `≤ M` child plans first (see runbook).

## Definition of done (every plan)

1. A **real test** that fails today and passes after the change (not a tautology).
2. `bun run lint && bun run build` green; targeted tests green.
3. Docs updated in the same change if user-facing (esp. `docs/content/ai-agent.mdx`, `.env.example`, pricing).
4. The **status row above** flipped to `DONE` (or `IN REVIEW` if awaiting merge).
5. Honors the **self-hosted-stays-whole** and **fail-closed-to-OSS** invariants.

## Changelog of this roadmap

- 2026-07-02 — Initial roadmap created from product audit + market research (competitors, ClickHouse native AI/MCP, pricing benchmarks). Grounded at commit `ab4c34426`.
