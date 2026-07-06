# 03 — SEO, Blog & Marketing Plan (2026 H2)

> Companion to [`01-market-research.md`](01-market-research.md). Turns the research into
> an executable content + distribution plan. Ties to roadmap Wave G (Plans 60–70).

## Strategy in one line

**Teach the exact ClickHouse pain deeply, embed real diagnostic SQL only a monitoring
tool can show, give the OSS core away, and let developers distribute it.** This is the
through-line across ClickHouse, SigNoz, PostHog, and pganalyze.

## 1. SEO — the compounding engine

The keyword space splits into three buckets with very different difficulty. **Build in
this order** because it front-loads the winnable, highest-intent traffic:

### Wave 1 — Error / problem pages (low difficulty, highest intent)
SERPs here are thin templated aggregators (OneUptime, Tinybird, Pulse); only
ClickHouse.com docs are strong. **Each page doubles as a live product demo.**

1. `clickhouse too many parts` — causes + fix + tool demo
2. `clickhouse MEMORY_LIMIT_EXCEEDED fix`
3. `clickhouse "memory limit (total) exceeded"`
4. `clickhouse merges slower than inserts`

### Wave 2 — The flagship `system.query_log` cluster (the SEO page *is* the product)
5. `clickhouse find slow queries (system.query_log)` — **flagship how-to + demo**
6. `clickhouse system.query_log examples` — reference + demo
7. `clickhouse monitor active parts / over-partitioning` — how-to + demo

### Wave 3 — Optimization hub (medium difficulty, deep example-driven content)
8. `clickhouse partition key best practices`
9. `clickhouse partition granularity (day vs month)`
10. `clickhouse PREWHERE vs WHERE`
11. `clickhouse projections vs materialized views` — decision guide
12. `clickhouse projections complete guide`
13. `clickhouse skip indices / secondary index guide`
14. `reduce clickhouse query memory (external group by)`

### Wave 4 — Targeted comparisons (high difficulty, build only near-ICP)
15. `clickhouse vs timescaledb` (high ICP)
16. `clickhouse vs postgres for analytics` (high ICP)
17. `clickhouse vs druid vs pinot` (3-way)

### Pillar pages (link hubs)
- `clickhouse query optimization (definitive guide)`
- `clickhouse cost / memory optimization checklist`

**The moat vs content farms:** every page embeds real diagnostic SQL against
`system.query_log` / `system.parts` / `system.merges` **and the expected output**, then
shows chmonitor doing it in one click. Aggregators cannot do this.

### On-page / technical SEO (Plans 69, 70)
- OG images per page + meta audit (Plan 69).
- Lighthouse/perf pass — static-first, CDN-cached (Plan 70).
- Programmatic use-case landing pages from the query-config registry (Plan 64).
- Comparison sub-pages vs competitors (Plan 63).

## 2. Blog — the "5 min of ClickHouse" series

Model on pganalyze's "5mins of Postgres" and PostHog's listicles. Cadence: **1 deep
post/week**, each repurposed into a 5-min video + a Twitter/X thread + a Slack-shareable
snippet.

**First 8 cornerstone posts (ship these before Show HN):**
1. Diagnosing "Too Many Parts" from `system.parts` (with the exact query)
2. Finding your 10 slowest ClickHouse queries from `system.query_log`
3. Reading `system.merges` — is your cluster in a merge storm?
4. When a mutation rewrites a billion rows: `ALTER … DELETE` cost explained
5. PREWHERE vs WHERE: how granule skipping actually works
6. Projections vs materialized views — a decision tree
7. Partition key mistakes that quietly kill performance
8. Escaping MEMORY_LIMIT_EXCEEDED without buying a bigger box

Each post ends with: "chmonitor runs this diagnostic continuously and tells you the fix
— `docker run … chmonitor`." Ties to Plan 67 (docs/blog content engine).

## 3. Distribution channels (priority order)

**1. OSS / GitHub-led (primary).** README as a landing page: hero GIF of the advisor
flagging a real problem, copy-paste quickstart, before/after benchmark. Zero-signup CLI
that runs `system.query_log`/`system.parts` diagnostics locally. PR onto
[awesome-clickhouse](https://github.com/korchasa/awesome-clickhouse). Exploit the
standing top-of-funnel: ClickHouse docs already cite `duyet/clickhouse-monitoring`
(~219 stars) — add a clear chmonitor on-ramp from that repo (Plan 68 social proof).

**2. ClickHouse community.** Be helpful first, mention the tool only when it's the
literal answer. Community Slack (~4k members), meetups (offer a talk: "Diagnosing slow
ClickHouse queries from system tables"), GitHub discussions.

**3. Technical SEO content** (section 1–2 above) — the compounding engine.

**4. Show HN — one big shot.** Title: "Show HN: chmonitor – open-source ClickHouse
query advisor with an MCP server." Link a live demo/runnable repo; maker's first comment
names one honest limitation; Tue–Thu ~9am–12pm ET; reply within 60 min. **Do not launch
until README + live demo + onboarding are polished** (Plans 60, 65, 66).

**5. MCP / AI-agent distribution (the differentiator, competitor-free).** List on the
official MCP Registry, PulseMCP, cursor.directory, Smithery/Glama. One-command
`claude mcp add` + Cursor snippets in README. Hook: "Ask Claude why your ClickHouse
query is slow." This is a distribution channel none of the competitors have.

**6. Newsletters & Reddit (amplification).** Sponsor niche DB/data-eng newsletters
(~$750–1,500/issue). **Do NOT budget for The Pragmatic Engineer newsletter — it takes no
sponsorships (podcast only).** Reddit r/dataengineering, r/Database, r/clickhouse — lead
with a benchmark/teardown, not an announcement.

## 4. Instrumentation (do this first — Plan 62)

You can't optimize what you can't measure. Ship **product-analytics funnel (Plan 62)** and
a private founder dashboard before the content push: track install → connect cluster →
first advisor recommendation → paywall hit → upgrade. Baseline GitHub stars, self-host
telemetry pings, and X followers now (they're currently "measure first" in the vision doc).

## 5. Sequencing (6-month)

1. **Weeks 1–2:** Instrument the funnel (Plan 62); baseline stars/installs/followers.
2. **Weeks 2–6:** Landing hero + advisor-forward feature sections (Plans 60, 61); OG/perf
   audit (69, 70); write cornerstone posts 1–8.
3. **Weeks 4–8:** Ship Wave-1 + Wave-2 SEO pages; MCP registry listings; awesome-clickhouse
   PR; seed value in Slack.
4. **Week ~8:** Live demo + sample-cluster onboarding polished (Plans 65, 66) → **fire the
   Show HN** with the MCP "ask your agent" wow.
5. **Weeks 8–24:** Sustain the pganalyze-style content engine (1 post/week); build the
   optimization hub + 2–3 comparison pages; measure per-format engagement on X.
