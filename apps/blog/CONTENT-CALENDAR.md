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
5. When flipping `draft` to `false`, set `date` to the **actual merge/publish
   date** (today), never a pre-planned calendar slot — `date` is not a
   scheduling field, it's what "latest" sorts by on the homepage, `/llms.txt`,
   and RSS. `isPublished()` (`apps/blog/src/lib/published.ts`) also treats
   `date > now` as unpublished regardless of `draft`, so a future `date` on a
   non-draft post won't render live, it'll just silently vanish from every
   listing until that date arrives — don't rely on that as a scheduling
   mechanism. To genuinely schedule a post for later, keep `draft: true` until
   its real publish day. Mark the row below `done` and move on.

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
| 3 | how-to | Ask your cluster anything: the AI agent over MCP | clickhouse ai agent mcp | `/guide/ai-agent` | done (`clickhouse-ai-agent-mcp.md`, published 2026-07-10) |
| 4 | troubleshooting | Why is my ClickHouse replication lagging? | clickhouse replication lag | `/guide/features` (replication section) | done (`clickhouse-replication-lag.md`, published 2026-07-10) |
| 5 | how-to | The query advisor: DDL recommendations you review, not that run themselves | clickhouse query optimization advisor | `/guide/ai-agent` (advisor tools) | done (`clickhouse-query-optimization-advisor.md`, published 2026-07-10) |
| 6 | case-study | Diagnosing a slow-query regression start to finish | clickhouse slow query diagnosis | `/guide/features` | done (`find-slow-clickhouse-queries.md`, published 2026-07-10, covers this slot as a how-to) |
| 7 | troubleshooting | Reading `system.merges` when merges pile up | clickhouse merges stuck | `/guide/features` | done (`clickhouse-system-merges-merge-storm.md`, published 2026-07-03) |
| 8 | how-to | Self-hosting chmonitor on Docker in five minutes | self-host clickhouse dashboard docker | `/operate/deploy/docker` | done (`clickhouse-self-hosting-docker.md`, published 2026-07-10) |
| 9 | how-to | Self-hosting chmonitor on Kubernetes | clickhouse monitoring kubernetes | `/operate/deploy/k8s` | done (`clickhouse-monitoring-kubernetes.md`, published 2026-07-10) |
| 10 | troubleshooting | Debugging `system.errors` spikes | clickhouse system errors | `/guide/features/health` | done (`clickhouse-system-errors-spikes.md`, published 2026-07-10) |
| 11 | case-study | Capacity planning with the TTL and disk-growth advisor | clickhouse capacity planning ttl | `/guide/ai-agent` (advisor tools) | done (`clickhouse-capacity-planning-ttl.md`, published 2026-07-10) |
| 12 | release | (scaffold from the next GitHub release when it ships) | — | `/reference/releases` | planned |
| 13 | troubleshooting | ClickHouse disk is full — what to do right now | clickhouse disk full emergency | `/guide/features` | done (`clickhouse-disk-full-emergency.md`, published 2026-07-10) |

## Published this cycle (homepage redesign + SEO expansion)

The blog homepage was redesigned into category cards grouped by `tag`, with the
Release category highlighted full-width and the rest rendered as compact
post-title lists. Alongside it, six SEO posts were added (all reusing verified
`system.*` SQL from the docs guides, with bidirectional cross-links):

| Date | Type | Title | Target keyword | Cross-link (docs page) |
|---|---|---|---|---|
| 2026-07-10 | 5 min | ClickHouse skip indices that actually prune | clickhouse skip index / data skipping index | `/guide/guides/skip-indices-guide` |
| 2026-07-10 | 5 min | Spill GROUP BY to disk instead of OOMing | clickhouse external group by / memory limit exceeded | `/guide/guides/external-group-by` |
| 2026-07-10 | 5 min | Fix "Memory limit (total) exceeded" | clickhouse memory limit total exceeded | `/guide/guides/memory-limit-total-exceeded` |
| 2026-07-10 | 5 min | Connect a firewalled ClickHouse to chmonitor Cloud | clickhouse behind firewall cloudflare tunnel | `/guide/guides/connect-firewalled-clickhouse` |
| 2026-07-10 | 5 min | Upgrade ClickHouse safely while chmonitor stays connected | upgrade clickhouse safely | `/guide/guides/upgrade-clickhouse` |
| 2026-07-10 | how-to | The 6 root causes of slow ClickHouse | clickhouse query optimization | `/guide/guides/clickhouse-query-optimization` |

_Dates above were placeholder calendar slots written into already-published
(`draft: false`) files instead of the actual merge date, which put these posts
months in the future while live — see #2697. Corrected to the real
first-commit date (`git log --diff-filter=A --format=%aI -- <file> | tail
-1`); both PRs that added these posts landed the same day, hence the shared
date._

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
