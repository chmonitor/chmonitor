# 20 — Growth, Distribution & X

> Priority: P0 · Effort: M · Risk: LOW · Depends on: 14 (a landing that converts the traffic this sends) · 13 (so converted signups can pay).
> Category: Adoption · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

chmonitor is the owner's life project and the audit shows real assets — an anonymous install telemetry pipeline (`apps/telemetry`, Analytics Engine + optional D1 forever-retention), a docs site, a blog, and citation in ClickHouse's own docs — but **no distribution system and no founder-facing scoreboard**. Concretely:

- **No repeatable content engine.** There's no calendar, no formats, no cadence. Build-in-public momentum on X/Twitter is the cheapest growth channel for a developer-tool solo founder, and right now it's ad hoc.
- **No SEO map.** The highest-intent ClickHouse-ops queries — "ClickHouse monitoring", "ClickHouse slow query", "ClickHouse merges", "ClickHouse replication lag" — aren't mapped to owned pages (blog/docs), so we don't rank for our own wedge.
- **OSS distribution untapped.** ClickHouse community Slack, HN, r/dataengineering, `awesome-clickhouse` lists — no launch/list-add checklist exists.
- **Founder is flying blind.** MRR (Polar), installs (telemetry), GitHub stars, and X followers live in four dashboards. There's no single private view of "is the flywheel turning?" — so it's impossible to know week-over-week whether growth work is working.

This plan is deliberately artifact-heavy: an autonomous agent can *draft* content and *build* the metrics view even though it can't press "post."

## Goal

**Ship a repeatable growth system: a founder-metrics dashboard that unifies MRR + installs + stars + followers, an SEO keyword→page map, an OSS distribution checklist, and a weekly X/Twitter content calendar an agent can draft from — all as committed artifacts with a link/lint acceptance check.** (Measurable: the four deliverable files below exist, pass a markdown-lint + link-check, and the founder-metrics artifact renders real numbers from the telemetry SQL + Polar/GitHub APIs.)

## Design

Deliverables live under `docs/marketing/` (new) and a small `apps/founder-metrics/` (or a script + static HTML), so nothing touches product code paths.

### A. Founder metrics dashboard — `apps/founder-metrics/` (private)

A single private view of the flywheel. Cheapest viable form: a Cloudflare Worker (or a `bun` script that emits a static `dist/index.html`) that pulls:

- **Installs** — from the telemetry Analytics Engine SQL API exactly as documented in `apps/telemetry/README.md`:
  ```sql
  SELECT count(DISTINCT index1) AS active_installs
  FROM chm_telemetry
  WHERE blob1 = 'ping' AND timestamp > now() - INTERVAL '30' DAY
  ```
  plus the by-`deploy_target`/`ch_version` breakdown and, if D1 is attached, the forever-retained `ping_daily` trend.
- **MRR / paying orgs** — Polar API (`getPolarClient()`-style, read-only) — subscriptions count × plan price from `@chm/pricing`. Reuse the product↔plan mapping in `apps/dashboard/src/lib/billing/polar-config.ts` conceptually (this worker reads its own env: `POLAR_ACCESS_TOKEN`, `CHM_POLAR_PRODUCT_*`).
- **GitHub stars + trend** — GitHub REST (`/repos/chmonitor/chmonitor`), star count + weekly delta.
- **X followers** — X API v2 `/2/users/by/username/:handle?user.fields=public_metrics` (needs a bearer token env `X_BEARER_TOKEN`); if no API access, a manual-entry JSON the agent updates weekly (`data/x-followers.json`).

Output: KPI cards (MRR, active installs, stars, followers) + sparklines, behind Cloudflare Access or a shared secret (private — this is the founder scoreboard, not public). Env-driven; **no secrets in the repo**. Ship a `README.md` with the exact deploy + token setup. Reuses the telemetry query patterns already in `apps/telemetry/README.md` so it can't drift.

### B. SEO keyword → page map — `docs/marketing/seo-keyword-map.md`

A table mapping intent keywords to an owned target page (blog post or docs page), search-intent, and status. Seed rows (the wedge):

| Keyword | Intent | Target page | Type | Status |
|---|---|---|---|---|
| clickhouse monitoring | commercial | `/` landing + `blog/clickhouse-monitoring-guide` | pillar | TODO |
| clickhouse slow query | informational | `blog/find-slow-queries-clickhouse` | how-to | TODO |
| clickhouse merges (too many parts) | informational | `blog/clickhouse-merges-explained` | how-to | TODO |
| clickhouse replication lag | informational | `blog/clickhouse-replication-lag` | how-to | TODO |
| clickhouse system tables cheatsheet | informational | `blog/clickhouse-system-tables` | reference | TODO |
| pganalyze for clickhouse | commercial | `/` landing | positioning | TODO |

Each row: primary keyword, 2–3 secondary, the ClickHouse `system.*` table the post is grounded in (credibility + internal links to docs), and a CTA to the dashboard. Include an on-page-SEO checklist (title ≤60c, meta description, one H1, internal link to docs + pricing, canonical).

### C. OSS distribution checklist — `docs/marketing/distribution-checklist.md`

A launch/list-add runbook with owner-fillable status:

- **awesome-lists:** open PRs to `awesome-clickhouse` and any `awesome-database-tools` — draft the one-line entry.
- **ClickHouse community Slack:** intro + share cadence rules (contribute first, link sparingly).
- **HN:** a "Show HN" draft (title + body) + best-time guidance; the benchmark/teardown angle, not a plain product pitch.
- **Reddit:** r/dataengineering, r/clickhouse, r/selfhosted — value-first post drafts, subreddit rules noted.
- **Directories:** Product Hunt, AlternativeTo (vs Datadog/Grafana/Altinity), OSS directories.
- Each item: draft copy + link + status column. Agent drafts; human posts.

### D. Weekly X/Twitter content system — `docs/marketing/x-content-calendar.md`

The concrete, agent-draftable engine. Contains:

- **Cadence:** 1 build-in-public thread/week, 3–4 short posts/week, 1 benchmark/teardown/month, reply-in-public daily to ClickHouse-ops questions.
- **Formats (with templates the agent fills):**
  1. *Build-in-public metric drop* — "This week in chmonitor: {installs} installs, {stars} stars, shipped {feature}. Here's what I learned →" (pulls numbers from deliverable A).
  2. *Teardown* — "We profiled a ClickHouse cluster drowning in `too many parts`. Here's the merge backlog and the fix →" (grounded in a real `system.parts`/`system.merges` example).
  3. *Benchmark* — chmonitor vs raw `system.query_log` spelunking; before/after time-to-diagnose.
  4. *Tip* — one ClickHouse ops tip + the `system.*` query, ending with "the AI agent does this for you."
  5. *Ship log* — screenshot + one-line changelog.
- **A 4-week starter calendar** (28 rows: date, format, hook, the draft, the asset needed, CTA), pre-filled with real ClickHouse-ops angles so week 1 can post immediately.
- **Rules:** wedge in bio ("pganalyze for ClickHouse"), always link the blog/docs page from the SEO map (closes the loop A→B→D), never post raw metrics that expose customers.

## Steps

1. **[S] Scaffold `docs/marketing/`** and write `seo-keyword-map.md` (B) and `distribution-checklist.md` (C) with the seed tables + on-page checklist + draft copy.
2. **[M] Write `x-content-calendar.md` (D)** — formats, cadence, templates, and a filled 4-week starter calendar grounded in real `system.*` angles. **Split: (a) formats + cadence + rules; (b) the 28-row 4-week calendar drafts.**
3. **[M] Build `apps/founder-metrics/` (A).** Worker/script that queries telemetry AE SQL (reuse `apps/telemetry/README.md` queries), Polar (MRR), GitHub (stars), X (followers or manual JSON); renders KPI cards + sparklines; gated private; env-driven; `README.md` with deploy + tokens. **Split: (a) telemetry + GitHub reads → static HTML; (b) Polar MRR; (c) X followers + private access gating.**
4. **[XS] Cross-link the loop.** Ensure the X calendar rows reference SEO-map target pages, and the distribution checklist points to the same pages — one flywheel A(metrics)→D(content)→B(SEO pages)→signups.
5. **[XS] Markdown-lint + link-check** all new marketing docs; fix broken links.

## Real test

This is a growth/content plan, so acceptance = verifiable artifacts + checks (not a unit test):

- **Artifacts exist:** `docs/marketing/seo-keyword-map.md`, `docs/marketing/distribution-checklist.md`, `docs/marketing/x-content-calendar.md`, and `apps/founder-metrics/` (with `README.md`) are committed.
- **Lint/link check passes:** a markdown-lint + link-check over `docs/marketing/**` exits 0 (no broken internal links to `/blog/*`, `/docs/*`, pricing, dash).
- **Metrics artifact renders real numbers:** running the founder-metrics script/worker against configured env produces a page with a non-placeholder active-install count sourced from the telemetry AE query (or, in dev with no tokens, clearly-labelled `—` cells and a green build — never fabricated numbers).
- **Calendar is complete:** `x-content-calendar.md` contains ≥28 dated, drafted rows (a script/grep asserts ≥28 table rows under the "4-week starter" heading).

## Verification

```bash
# Marketing docs lint + links
bunx markdownlint-cli2 "docs/marketing/**/*.md"
bunx linkinator docs/marketing --markdown --silent   # or repo link-checker
# Calendar completeness (≥28 drafted rows)
grep -c '^| 2026-' docs/marketing/x-content-calendar.md   # ≥ 28
# Founder metrics builds + renders
cd apps/founder-metrics && bun install && bun run build   # emits dist/ or deploy artifact
# with env set: prints/renders active_installs, stars, MRR, followers; without: labelled placeholders, still green
```

## Out of scope / STOP conditions

- **The agent drafts; it does not post.** No auto-tweeting, no auto-PRing to awesome-lists, no auto-posting to HN/Reddit/Slack. Every outbound item is a committed draft a human ships. (No write-scope social tokens.)
- **No fabricated metrics or endorsements.** Founder-metrics shows real API/telemetry numbers or explicit placeholders; content templates never invent customer names, benchmarks, or the ClickHouse-docs citation.
- **Founder metrics is private** — behind Cloudflare Access / a secret; never expose customer-identifying data (telemetry is anonymous by design; keep it that way). No secrets committed.
- Self-hosted/OSS product code is untouched — this plan lives in `docs/marketing/` and a standalone `apps/founder-metrics/` only. No dashboard/enforcement changes.
- Respect each channel's rules (contribute-first in ClickHouse Slack; subreddit self-promo limits) — the checklist encodes them, don't bypass.

## Done

- [ ] `docs/marketing/seo-keyword-map.md`, `distribution-checklist.md`, `x-content-calendar.md` committed and cross-linked.
- [ ] `apps/founder-metrics/` builds, renders MRR + installs + stars + followers (real or labelled placeholders), private-gated, `README.md` with setup.
- [ ] 4-week X calendar has ≥28 drafted, dated rows grounded in real ClickHouse-ops angles.
- [ ] Markdown-lint + link-check over `docs/marketing/**` green.
- [ ] Status row for **20** updated in `plans/roadmap/README.md`.
