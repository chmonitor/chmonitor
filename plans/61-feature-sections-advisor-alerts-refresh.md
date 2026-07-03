# 61 — Feature/capability/comparison sections: advisor + alerting

## Kickoff prompt

```text
Execute plans/61-feature-sections-advisor-alerts-refresh.md ALONE. Update the landing feature,
capability, and comparison sections ("everywhere") to foreground the ClickHouse advisor and
alerting, with real screenshots and an "Alert rules / channels" comparison row.
Invariants: self-hosted stays whole; MARKETING CLAIMS MUST MATCH SHIPPED + ENFORCED features
(verify each against apps/dashboard + packages/pricing before publishing); Postgres=NO for 2026 H2.
Read the plan fully, honor STOP conditions, then run every Verification command and update your row
in plans/README.md.
Verify: cd apps/landing && bun install --frozen-lockfile && bun run build; bun run lint.
```

## Current reality (audited)

`apps/landing` has `Features.astro` (AI Agent / Queries / Topology / Health), `Capabilities.astro`
(6-card grid), and `Comparison.astro` (vs Grafana/Datadog/ClickHouse native). Advisor and alerting
are under-represented; the comparison has no alerting row. Pricing/plan data comes from
`@chm/pricing` (single source of truth) surfaced via the landing pricing data.

## Goal

Advisor + alerting appear as first-class in Features + Capabilities, with real screenshots, and the
Comparison table gains an "Alert rules & channels" row — all claims verified against shipped code.

## Implement now (depth F)

- `apps/landing/src/components/Features.astro`: add an **Advisor** feature card (recommends
  projections/skip-indexes/partition keys/PREWHERE/MVs — recommends, never auto-applies) and an
  **Alerting** card (rules + channels: Slack/PagerDuty/Telegram/Discord/email + Prometheus). Use
  real screenshots (add assets); badge AI-backed items.
- `apps/landing/src/components/Capabilities.astro`: prepend "AI-backed" only where true; add an
  alerting capability entry.
- `apps/landing/src/components/Comparison.astro`: add an "Alert rules & channels" row; keep honest
  framing (chmonitor vs generic tools).
- Confirm each channel/feature claim exists in `apps/dashboard/src/lib/health/adapters/` and each
  plan limit in `packages/pricing`; if a channel isn't shipped (e.g. email = plan 25), don't list
  it until merged.

## STOP conditions & drift check

- STOP and verify each listed alert channel against `adapters/index.ts` (Slack/Discord/Telegram/
  PagerDuty/generic exist today; email = plan 25, Opsgenie = plan 26 — omit until merged).
- STOP if advisor isn't shipped (plan 46) — describe the AI agent's current advise/explain ability
  honestly rather than claiming DDL recommendations.
- Drift: confirm component names + the pricing data source.

## Verification

```
cd apps/landing && bun install --frozen-lockfile && bun run build
bun run lint
```

## Done criteria

- Advisor + alerting are first-class in Features + Capabilities with real screenshots.
- Comparison has an alerting row; every claim maps to shipped code (checked).
- Build green.

Priority: P1 · Effort: M · Depth: F · Wave: G (Growth) · Lever: Adoption / Revenue
