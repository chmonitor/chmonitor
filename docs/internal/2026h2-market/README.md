# 2026 H2 — Market, Strategy & Monetization (internal)

Market-research-driven strategy pack. Generated 2026-07-06. Grounded in verified
July-2026 competitor pricing and directly-fetched operator pain-point sources.
Supplements — does not replace — the numbered roadmap in `docs/plans/roadmap/` and
`plans/` (plans 14–70).

| Doc | What |
|---|---|
| [01-market-research.md](01-market-research.md) | Full cited research: pain points, competitors + verified pricing, willingness-to-pay, 25-keyword SEO map, GTM channels |
| [02-billing-analysis.md](02-billing-analysis.md) | Billing verdict + optimizations. TL;DR: price is right, **collection is broken** — fix that first |
| [03-seo-marketing-plan.md](03-seo-marketing-plan.md) | Executable SEO/blog/distribution plan tied to Wave G |
| [04-core-value-refresh.md](04-core-value-refresh.md) | Sharpened core value + what the research confirmed/changed |
| [05-implementation-tasks.md](05-implementation-tasks.md) | 15 concrete research-delta tasks (B1–B5, S1–S5, M1–M5) mapped to real files |
| [github-issues.csv](github-issues.csv) | The 15 tasks as a table |
| [create-github-issues.sh](create-github-issues.sh) | Ready-to-run `gh` script to create the issues (dry-run by default; `--apply` to create) |

## Headline conclusions

1. **Wedge confirmed, unoccupied:** nobody ships a pganalyze-style scored advisor for
   ClickHouse. Build the advisor; it's the reason to pick chmonitor and what justifies $99.
2. **Price is right, collection is broken:** $29/$99 undercuts pganalyze ~5×. But AI
   overage never bills, 402s return raw JSON, and there's no billing UI. Turning on
   collection (Plans 14–17) is *found money* — highest ROI in the roadmap.
3. **SEO: build error pages first** (thin SERPs, highest intent); flagship is the
   `system.query_log` slow-query how-to where the page *is* the product.
4. **The MCP server is a distribution channel** competitors don't have — list it everywhere.
5. **Watch ClickHouse Cloud's native AI** — the one real threat; our moat is the
   self-hosted / Altinity / BYOC surface + fleet view they won't serve.

## Creating the GitHub issues

The generating agent could not create live issues (no `gh`/token in its sandbox, and it
is not permitted to handle tokens). Run this on your authenticated machine:

```bash
cd docs/internal/2026h2-market
./create-github-issues.sh           # preview (dry-run)
./create-github-issues.sh --apply   # create in chmonitor/chmonitor
```

The existing plans 14–70 already have `plans/round3-issues.csv` for their own import.
