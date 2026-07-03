# 64 — SEO use-case landing pages

## Kickoff prompt

```text
Execute plans/64-seo-use-case-landing-pages.md ALONE (do not read other plans).
Goal: ship 4+ keyword-targeted use-case landing pages in apps/landing (queries,
cluster-health, replication, performance) behind a shared LandingPage layout,
internal-linked and in the sitemap.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: these are marketing pages only; touch no app code,
  no billing, no dashboard runtime.
- Marketing claims MUST match shipped features: every capability named on a page
  must exist in the product today (advisor recommends DDL / never auto-applies;
  alerting = Slack/Discord/Telegram/PagerDuty/generic; works on self-host/Docker/
  K8s/Cloud). No roadmap features stated as shipped. When unsure, cut the claim.
- Analytics/DNT: reuse the existing analytics wrapper (plan 62) if present; do not
  add a second tracker; respect Do-Not-Track; no PII.
- Postgres/multi-DB: NO. ClickHouse-only positioning.

When done, run the Verification block at the bottom and paste the output.
```

## Current reality (audited)

Why (roadmap §4/64, P2/L/E): chmonitor's landing is a single funnel page (`index.astro`)
plus `pricing`, `changelog`, `brand`, `404`. There are **no use-case / keyword-targeted
pages**, so long-tail organic intent ("ClickHouse replication monitor", "ClickHouse query
performance analyzer", "monitor ClickHouse cluster health") has no dedicated landing
surface to rank for. Per strategy §1, the growth lever is widening the funnel mouth with an
**honest, advisor-forward** presence — not competing with Grafana/Altinity on raw metrics.

Pointers (verify at head):
- Astro app: `apps/landing/` — `astro.config.mjs`, `src/pages/`, `src/components/`,
  `src/layouts/Base.astro`. Existing pages: `index.astro`, `pricing.astro`,
  `changelog.astro`, `brand.astro`, `404.astro`.
- Reusable content blocks already exist: `components/Hero.astro`, `Features.astro`,
  `Capabilities.astro`, `Comparison.astro`, `FinalCta.astro`, `Footer.astro`,
  `SocialProof.astro`, `Nav.astro`.
- No sitemap integration is confirmed — check `astro.config.mjs` for `@astrojs/sitemap`
  `(verify)`; if absent, add it (this is the mechanism that gets new pages indexed).
- Pricing/benefit copy is centralized — reuse the shared pricing data used by the
  landing (`apps/landing/src/data/pricing.ts` `(verify path)`) rather than re-typing claims.

## Goal

Four or more crawlable use-case pages (`/monitor-queries`, `/cluster-health`,
`/replication`, `/performance`) — each with a unique H1, unique title/description,
use-case-specific hero + benefits + a real product screenshot + one CTA — sharing a
`LandingPage.astro` layout, internally linked from the main page and footer, present in the
sitemap, and carrying valid `SoftwareApplication` schema. Every claim maps to a shipped
feature.

## Implement now (depth E — approach + key files + open questions)

### Approach
1. **Shared layout** — `apps/landing/src/layouts/LandingPage.astro` (new). Wrap
   `Base.astro` (which owns `<head>`/meta — see plan 69) and accept props: `title`,
   `description`, `h1`, `subhead`, `heroImage`, `benefits[]`, `ctaHref`, `ctaLabel`,
   `schema`. Compose existing `Nav`, `Footer`, `FinalCta`, `SocialProof` so pages stay
   visually consistent with `index.astro`.
2. **Page set** — one `.astro` per use case under `src/pages/`:
   - `monitor-queries.astro` — live/running query visibility + kill (already shipped), then
     the advisor angle ("see the slow query, get a recommended skip-index/PREWHERE — you
     apply it"). Keyword: *monitor ClickHouse queries / query performance analyzer*.
   - `cluster-health.astro` — health checks + alerting channels (Slack/Discord/Telegram/
     PagerDuty/generic). Keyword: *ClickHouse cluster health monitoring*.
   - `replication.astro` — replication-lag / read-only monitoring + alerting. Keyword:
     *ClickHouse replication monitor*.
   - `performance.astro` — query cost / advisor recommendations (recommend-only). Keyword:
     *ClickHouse performance tuning / optimization*.
3. **Screenshots** — reuse real product screenshots already used on the landing gallery;
   do not mock up UI that does not exist.
4. **Internal linking** — add a "Use cases" group to `Footer.astro` (and optionally a
   nav/section on `index.astro`) linking all four pages; cross-link related pages to each
   other.
5. **Sitemap + schema** — ensure `@astrojs/sitemap` is configured so the new routes are
   emitted; add `SoftwareApplication` JSON-LD per page via the layout.

### Key files
- New: `src/layouts/LandingPage.astro`; `src/pages/{monitor-queries,cluster-health,replication,performance}.astro`.
- Edit: `src/components/Footer.astro` (use-case links); `astro.config.mjs` (sitemap
  integration if missing); optionally `src/pages/index.astro` (link block).
- Reuse: `Base.astro`, `Nav.astro`, `FinalCta.astro`, `SocialProof.astro`, shared pricing/
  benefit data.

### Open questions (resolve during discovery)
- **Page set / keywords:** is the 4-page set above the right target, or should it track the
  gallery tabs (advisor / agent / alerts / topology)? Confirm the keyword list with whatever
  analytics/search-console signal exists; the layout must support 4–6 pages either way.
- **Sitemap:** is `@astrojs/sitemap` already wired, or does a custom sitemap exist? Do not
  double-emit.
- **Claim audit:** which advisor/alerting capabilities are actually shipped at head vs. still
  roadmap (plans 46/47 advisor, plan 25 email)? Only name shipped ones; leave a TODO comment
  where a page would strengthen once a roadmap feature lands.

## STOP conditions & drift check

- STOP if any use-case page already exists — reconcile/extend instead of duplicating.
- STOP and cut the claim if a capability a page would advertise is not shipped at head
  (advisor auto-apply is FORBIDDEN to imply; email alerts may not exist yet).
- DRIFT: if `Base.astro` does not centralize `<head>`/meta, coordinate with plan 69 rather
  than hand-rolling per-page `<meta>` here (avoid two meta systems).
- Do NOT add a second analytics library or any dashboard/runtime code.

## Verification

```
cd apps/landing && bun install --frozen-lockfile && bun run build
```

- Confirm the build emits `monitor-queries`, `cluster-health`, `replication`, and
  `performance` HTML pages and that each appears in the generated `sitemap*.xml`.
- Grep the built output to confirm each page has a **unique** `<title>` and
  `<h1>`, and that every advertised capability corresponds to a shipped feature.

## Done criteria

- ≥4 use-case pages build, each with a unique H1 + unique title/description and a real
  screenshot.
- Pages share `LandingPage.astro`; internal links exist (footer + cross-links); routes are
  in the sitemap.
- Valid `SoftwareApplication` schema per page; no unshipped-feature claims.
- `bun run build` for `apps/landing` is green.

Priority: P2 · Effort: L · Depth: E · Wave: G (Growth) · Lever: SEO / Adoption
