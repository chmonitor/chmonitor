# Content calendar

The plan-of-record for `blog.chmonitor.dev` cadence: **2 posts/month minimum**,
mixing four post types. This keeps a solo author sustainable — release posts and
how-tos are the cheapest to produce (they document work that already shipped),
troubleshooting and case-study posts are the highest-SEO-value but need more
lead time.

## How to use this file

1. Pick the next unstarted week's row.
2. Copy the matching template from `apps/blog/templates/` into
   `apps/blog/src/content/blog/<slug>.md` with `draft: true`.
3. Write the post. Every factual/feature claim must pass the template's
   **claim-verification checklist** before `draft` flips to `false`.
4. Add the docs cross-link in both directions (post → docs page it explains
   deeper, docs page → post for the narrative version) per the convention in
   `apps/blog/README.md`.
5. Run `pnpm run sync-latest-posts` from `apps/blog/` (see
   `scripts/sync-latest-posts.mjs`) to refresh the landing footer's "Latest
   from the blog" widget, then commit both together.
6. Mark the row below `done` and move on.

Release posts are the exception to "pick the next row on schedule" — scaffold
them on demand with `pnpm run release-to-post <tag>` (from `apps/blog/`) right
after a GitHub release ships, then slot the draft into whichever week is next.

## Status legend

`planned` → not started · `drafting` → post exists as `draft: true` · `done` →
published (`draft: false`, merged to main)

## The 12 weeks

| Week | Type | Working title | Target keyword | Cross-link (docs page) | Status |
|---|---|---|---|---|---|
| 1 | release | chmonitor v0.3 — a full rebuild | clickhouse monitoring dashboard | `/guide/getting-started` | done (`chmonitor-v0-3.md`, published 2026-06-29) |
| 2 | how-to | Alerting to Slack and Discord | clickhouse alerting webhook | `/guide/features/health` | moved to docs-only (`docs/content/guide/guides/alerting-slack-discord.mdx`), no blog post |
| 3 | how-to | Ask your cluster anything: the AI agent over MCP | clickhouse ai agent mcp | `/guide/ai-agent` | done (`clickhouse-ai-agent-mcp.md`, published 2026-07-17) |
| 4 | troubleshooting | Why is my ClickHouse replication lagging? | clickhouse replication lag | `/guide/features` (replication section) | done (`clickhouse-replication-lag.md`, published 2026-07-24) |
| 5 | how-to | The query advisor: DDL recommendations you review, not that run themselves | clickhouse query optimization advisor | `/guide/ai-agent` (advisor tools) | done (`clickhouse-query-optimization-advisor.md`, published 2026-07-31) |
| 6 | case-study | Diagnosing a slow-query regression start to finish | clickhouse slow query diagnosis | `/guide/features` | done (`find-slow-clickhouse-queries.md`, published 2026-07-10, covers this slot as a how-to) |
| 7 | troubleshooting | Reading `system.merges` when merges pile up | clickhouse merges stuck | `/guide/features` | done (`clickhouse-system-merges-merge-storm.md`, published 2026-07-03) |
| 8 | how-to | Self-hosting chmonitor on Docker in five minutes | self-host clickhouse dashboard docker | `/operate/deploy/docker` | done (`clickhouse-self-hosting-docker.md`, published 2026-08-14) |
| 9 | how-to | Self-hosting chmonitor on Kubernetes | clickhouse monitoring kubernetes | `/operate/deploy/k8s` | done (`clickhouse-monitoring-kubernetes.md`, published 2026-08-21) |
| 10 | troubleshooting | Debugging `system.errors` spikes | clickhouse system errors | `/guide/features/health` | done (`clickhouse-system-errors-spikes.md`, published 2026-08-28) |
| 11 | case-study | Capacity planning with the TTL and disk-growth advisor | clickhouse capacity planning ttl | `/guide/ai-agent` (advisor tools) | done (`clickhouse-capacity-planning-ttl.md`, published 2026-09-04) |
| 12 | release | (scaffold from the next GitHub release when it ships) | — | `/reference/releases` | planned |
| 13 | troubleshooting | ClickHouse disk is full — what to do right now | clickhouse disk full emergency | `/guide/features` | done (`clickhouse-disk-full-emergency.md`, published 2026-09-11) |

## Post-type mix (per 12-week cycle)

- Release: 2 (as releases actually ship — do not invent a cadence releases
  don't have)
- How-to: 5
- Troubleshooting: 3
- Case study: 2

## Ownership

One author, part-time. The templates + `release-to-post.mjs` exist specifically
so this cadence survives without a dedicated content team — a release post
should take under an hour once the release itself is done, because the script
pre-fills tag/date/changelog links and the author only writes the "what it
means for you" framing plus runs the verification checklist.
