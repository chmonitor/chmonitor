# 63 — Comparison pages vs Grafana / Datadog / ClickHouse Cloud

## Kickoff prompt

```text
Execute plans/63-comparison-pages-vs-competitors.md ALONE. Add honest, high-intent comparison
pages: /vs-grafana, /vs-datadog, /vs-clickhouse-cloud, each a deep feature matrix + setup-time/TCO
framing + CTA, linked from the main comparison section.
Invariants: self-hosted stays whole; CLAIMS MUST BE HONEST + CURRENT — verify chmonitor rows
against shipped code and competitor rows against their current public docs; no strawman; Postgres=NO
for 2026 H2. Read the plan fully, honor STOP conditions, then run every Verification command and
update your row in plans/README.md.
Verify: cd apps/landing && bun install --frozen-lockfile && bun run build; bun run lint.
```

## Current reality (audited)

The landing has a single on-page comparison matrix (`apps/landing/src/components/Comparison.astro`,
vs Grafana/Datadog/ClickHouse native). There are **no dedicated /vs-* pages** (landing pages today
are only index/pricing/changelog/brand/404). "vs" queries are high purchase-intent SEO traffic.
Market context (verified 2026): ClickHouse Cloud has Cloud-locked Ask-AI + MCP + Agents; Grafana
uses the Altinity plugin (16.6M downloads) / official datasource; Datadog has a ClickHouse
integration; pganalyze charges $149/server.

## Goal

Three honest, keyword-targeted comparison pages with a shared reusable table, positioned around
chmonitor's true differentiators (ClickHouse-specific advisor, alerting, works on every deployment,
OSS, cost) — not strawmen — each with a CTA.

## Implement now (depth E — resolve open questions during discovery)

- New shared `apps/landing/src/components/ComparisonTable.astro` (reusable, data-driven rows).
- New pages `apps/landing/src/pages/{vs-grafana,vs-datadog,vs-clickhouse-cloud}.astro`, each:
  hero for the comparison, ≥10-row matrix, setup-time + TCO framing, honest disclaimers, CTA
  ("Try chmonitor free" / "Open dashboard").
- Position honestly: acknowledge Grafana/Altinity own raw-metrics dashboards and Datadog owns
  full-stack APM; chmonitor wins on ClickHouse-specific advisor + alerting + self-host + cost +
  MCP; ClickHouse Cloud's Ask-AI/Agents are Cloud-locked + analytics-first (not ops-advisor for
  self-hosters).
- Link from `Comparison.astro`; add schema.org markup + per-page meta (coordinate with plan 69).
- **Open questions:** exact competitor rows/pricing to cite (re-verify at write time), TCO
  calculator scope (static table vs interactive), how many rows.

## STOP conditions & drift check

- STOP and re-verify competitor capabilities/pricing against current public docs at write time
  (they change); cite honestly, date the claims.
- STOP if a chmonitor row overstates shipped features — verify against `apps/dashboard`.
- Drift: confirm the landing pages dir + routing convention.

## Verification

```
cd apps/landing && bun install --frozen-lockfile && bun run build
bun run lint
```

## Done criteria

- 3 /vs-* pages build, each with a ≥10-row honest matrix + CTA, linked from the main comparison.
- chmonitor rows verified against shipped code; competitor rows dated + sourced.
- Schema/meta present (or handed to plan 69).

Priority: P1 · Effort: M · Depth: E · Wave: G (Growth) · Lever: SEO / Adoption
