# 05 — Research-Driven Implementation Tasks (2026 H2)

> New, concrete tasks surfaced by the market research that **supplement** the existing
> plans 14–70. Each maps to real files. These become GitHub issues via
> [`create-github-issues.sh`](./create-github-issues.sh) / [`github-issues.csv`](./github-issues.csv).
> Existing plans already cover most of Waves R/AI/A/I/G — the tasks below are the
> *deltas* the fresh research adds, mostly in billing pricing config and SEO content.

Verification baseline for every code task (house convention):
`bun run type-check` · `bun run build` · targeted `bun test … --isolate` · `bun run lint`.

## Billing / pricing (research deltas beyond Plans 14–18)

**B1 · Explicit included-host counts per tier (P1/S).** `packages/pricing/src/plans.ts`.
Add an explicit `includedHosts` per tier (Pro=1, Max=3) so multi-node clusters don't hit
surprise overage. Surface on landing pricing cards (`apps/landing/src/data/pricing.ts`)
and the in-app billing card. *Kills the #1 pricing sticker-shock risk from the research.*

**B2 · Replica = 0.5 billable host (P2/M).** `packages/pricing/src/plans.ts` +
`apps/dashboard/src/lib/billing/entitlements.ts` (host counting). Bill a detected replica
as 0.5 host (copy pganalyze). Requires replica detection from `system.replicas`.

**B3 · BYOK on Free/Pro for the AI advisor (P1/M).** AI agent config in `apps/dashboard`.
Allow user-supplied model API key; skip included-credit metering when BYOK is active.
Expands funnel + protects margin (confirmed 2026 expectation). Measure BYOK vs
included-credit conversion.

**B4 · "$199 Fleet" mid-anchor tier (P2/M).** `packages/pricing/src/plans.ts`. Optional
tier for 5–10 host clusters (5 hosts included) to avoid overage surprise and capture the
multi-node segment. Ship behind an experiment flag; A/B against Max + overage.

**B5 · Annual billing (~2 months free) (P2/S).** Pricing package already implies
`yearly = 10× monthly`; wire the annual SKU end-to-end after Plan 17 e2e tests pass.

## SEO content pages (research deltas beyond Plans 63/64)

Built in `apps/blog/src/content/blog` (posts) and `apps/landing/src` (use-case landing
pages). Each embeds real diagnostic SQL + expected output + a one-click chmonitor demo.

**S1 · Error-page cluster (P1/M).** 4 pages: too-many-parts, MEMORY_LIMIT_EXCEEDED,
"memory limit (total) exceeded", merges-slower-than-inserts. Lowest difficulty, highest
intent — build first.

**S2 · Flagship `system.query_log` slow-query how-to (P1/M).** The SEO page *is* the
product workflow. Include the exact `query_duration_ms > 5000` query + a GIF of chmonitor
surfacing it.

**S3 · Optimization hub (P2/L).** Partition keys, partition granularity, PREWHERE vs
WHERE, projections vs MVs, skip indices, external GROUP BY. Interlinked hub + pillar page.

**S4 · Near-ICP comparison pages (P2/M).** ClickHouse vs TimescaleDB, vs Postgres (for
analytics), vs Druid/Pinot. Only these — the rest are ClickHouse.com's turf.

**S5 · OG images + meta audit + Lighthouse pass (P1/S).** Extends Plans 69/70 across the
new pages.

## Marketing / distribution

**M1 · Product-analytics funnel + founder dashboard (P0/M).** Extends Plan 62. Track
install → connect → first advisor recommendation → paywall hit → upgrade. **Do first —
can't optimize what you don't measure.** Baseline stars/installs/followers.

**M2 · "5 min of ClickHouse" blog engine — first 8 cornerstone posts (P1/L).** Content in
`apps/blog`. Extends Plan 67. Each post → 5-min video + X thread + Slack snippet.

**M3 · MCP registry listings (P1/S).** List `apps/mcp` server on the official MCP
Registry, PulseMCP, cursor.directory, Smithery/Glama. One-command `claude mcp add` +
Cursor snippet in README. *Competitor-free distribution channel.*

**M4 · README-as-landing-page + awesome-clickhouse PR (P1/S).** Hero GIF of the advisor
flagging a real problem, copy-paste quickstart, before/after benchmark. PR onto
awesome-clickhouse; add a chmonitor on-ramp from `duyet/clickhouse-monitoring`.

**M5 · Zero-signup local diagnostics CLI (P2/M).** `rust/` CLI runs
`system.query_log`/`system.parts` diagnostics locally with no account — top-of-funnel
wow that becomes a Show HN artifact.

## Sequence

1. **M1** (instrument) → 2. **Plans 14–17 + B1** (turn on money, kill sticker shock) →
3. **S1/S2 + M3/M4** (SEO error pages + MCP/README distribution) →
4. **Wave AI advisor** (the value) → 5. **Show HN** (Plans 60/65/66 polished) →
6. **M2 + S3/S4 + B3/B4** (sustain content engine + pricing experiments).
