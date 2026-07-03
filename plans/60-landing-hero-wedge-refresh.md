# 60 — Landing hero: advisor + alerting + all-deployment wedge

## Kickoff prompt

```text
Execute plans/60-landing-hero-wedge-refresh.md ALONE. Rewrite the landing hero (apps/landing) to
lead with the wedge that beats Cloud-locked "Ask AI": a ClickHouse-specific ADVISOR (recommends
projections/skip-indexes/partition keys/PREWHERE/MVs), ALERTING, and "works on every deployment"
(self-host, Docker, K8s, Cloud). Reorder the hero gallery to lead with advisor/agent/alerts/topology.
Invariants: self-hosted stays whole; MARKETING CLAIMS MUST MATCH SHIPPED + ENFORCED features — no
overselling (verify each claim against apps/dashboard before publishing copy); Postgres=NO for 2026
H2. Read the plan fully, honor STOP conditions, then run every Verification command and update your
row in plans/README.md.
Verify: cd apps/landing && bun install --frozen-lockfile && bun run build; bun run lint.
```

## Current reality (audited)

`apps/landing` is Astro. Current hero headline: **"See every ClickHouse query. As it runs."** with
a subhead centered on queries/merges/parts/replication + "an AI agent that answers questions." The
advisor, alerting, and multi-deployment story are absent from the hero. Components exist:
`Hero.astro`, `Features.astro`, `Capabilities.astro`, `Comparison.astro`, `FinalCta.astro`,
`SocialProof.astro`, `Nav.astro`, `layouts/Base.astro`. (No `data/` or `scripts/` dir yet —
`(verify)`.)

## Goal

A hero that names the advisor + alerting in the first two lines and states "works on every
deployment," a reordered gallery leading with advisor/agent/alerts/topology, consistent accent on
the key terms, and a secondary "See a live demo" CTA (ties to plan 65). Every claim matches shipped
code.

## Implement now (depth F)

- `apps/landing/src/components/Hero.astro`:
  - Rewrite headline to lead with the advisor+alerting wedge. Direction (pick/adapt, keep honest):
    *"The ClickHouse cluster advisor — and everything you need to watch it."* Subhead names three
    pillars: (1) live query/merge/replication visibility, (2) an AI advisor that recommends
    projections, skip-indexes, partition keys, PREWHERE & MVs — **recommends, never auto-applies**,
    (3) alerting to Slack/PagerDuty/email + Prometheus/Grafana — self-host, Docker, K8s, or Cloud.
  - Reorder the gallery tabs so the first 4–5 are advisor/agent, alerts, topology, insights.
  - Keep primary CTA "Open dashboard"; add secondary "See a live demo" (guard until plan 65 ships —
    link to docs quickstart if demo not live yet).
- Apply the brand accent consistently to "advisor" / "alerts".
- Update `FinalCta.astro` to echo the new wedge.
- Do NOT claim an unshipped capability. If a pillar item (e.g. advisor) isn't shipped yet, phrase
  as the honest current state or gate the copy behind the feature landing (coordinate with plan 46).

## STOP conditions & drift check

- STOP and verify each hero claim against `apps/dashboard` shipped features before publishing (esp.
  advisor recommendations — plan 46). If the advisor isn't merged, soften to "AI agent that
  explains and advises" rather than "recommends DDL."
- Drift: confirm the gallery/tab data source and screenshot asset names before reordering.

## Verification

```
cd apps/landing && bun install --frozen-lockfile && bun run build
bun run lint
```

## Done criteria

- Hero names advisor + alerting in the first two lines and states multi-deployment support.
- Gallery leads with advisor/agent/alerts/topology.
- No claim exceeds shipped/enforced features (checked); build is green.

Priority: P0 · Effort: L · Depth: F · Wave: G (Growth) · Lever: Adoption / SEO
