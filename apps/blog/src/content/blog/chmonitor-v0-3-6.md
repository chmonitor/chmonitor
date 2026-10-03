---
title: "chmonitor v0.3.6 — Less menu. More cluster."
description: "Everything since v0.2 in one place: a sidebar cut from 16 menus to 5 task groups, a faster dashboard, Cloud, Postgres and PeerDB monitoring, alerting, AI, and new compare tools."
date: 2026-10-03
tag: Release
cover: /posts/v0.3.6/cover.webp
---

If you last used chmonitor on v0.2, this is the post to read. Since v0.2.16
there have been **95 new features, 179 fixes, and 10 performance
improvements**. Here's the 60-second version.

<figure class="video">
  <iframe src="https://www.youtube-nocookie.com/embed/n8p4JwNHcGQ?rel=0" title="chmonitor v0.3.6 launch video" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="eager"></iframe>
  <figcaption>chmonitor v0.3.6 — less menu, more cluster. <a href="https://www.youtube.com/watch?v=n8p4JwNHcGQ" target="_blank" rel="noopener">Watch on YouTube</a>.</figcaption>
</figure>

## What's new since v0.2

<div class="hl-grid">
  <div class="hl"><b>Cleaner navigation</b><span>From 16 menus and 93 pages to 5 task groups plus More. Customizable per role.</span></div>
  <div class="hl"><b>Faster</b><span>Cached queries 3.58s → 0.17s, idle polling 132 → 73 req/min, JS 6.9 → 5.0 MB.</span></div>
  <div class="hl"><b>Cloud</b><span>A hosted dashboard with a public demo. Docker, Helm, and Cloudflare Workers from one codebase.</span></div>
  <div class="hl"><b>Beyond ClickHouse</b><span>Postgres monitoring (beta) and PeerDB CDC with fleet metrics and alerts.</span></div>
  <div class="hl"><b>Alerting</b><span>Templates, presets, channels, health reports, and custom webhooks configured through Helm.</span></div>
  <div class="hl"><b>AI built in</b><span>An agent, Insights, advisors, an MCP server, and an MCP Playground.</span></div>
  <div class="hl"><b>New tools</b><span>Schema Compare, Settings Diff, TTL and partition health, cluster topology, SQL Console.</span></div>
  <div class="hl"><b>Workspace roles</b><span>Full, DBA, Engineer, and SRE presets hide the pages a role doesn't need.</span></div>
</div>

## Less menu

The v0.2 sidebar showed everything at once: 16 menus and 93 pages, most of
them expanded. v0.3.6 starts with the pages you use every day — Overview,
Queries, Data & Storage, Alerts & Insights, Tools & AI — and puts the rest
under **More**, where you can search hidden pages or pin them back.

<img src="/posts/v0.3.6/sidebar.webp" alt="Before and after: the v0.2 sidebar with every menu expanded next to the v0.3.6 sidebar with five task groups and a searchable More menu" width="2000" height="1250" loading="eager" />

Every page can be pinned, hidden, or kept in the sidebar from its header.
Workspace roles (Full, DBA, Engineer, SRE) set a starting point, and you can
customize from there.

## More cluster

### Faster where it counts

| | Before | After |
|---|---|---|
| Repeat chart query (served from cache) | 3.58s | 0.17s |
| Idle polling on Overview | 132 req/min | 73 req/min |
| JavaScript on Overview | 6.9 MB | 5.0 MB |
| Settings requests per page load | 16 | 1 |

Idle polling was measured live on a v0.2 and a v0.3.6 deployment, 60 seconds
idle on Overview. The other rows come from our
[frontend performance baseline](https://github.com/chmonitor/chmonitor/blob/main/docs/knowledge/frontend-perf-baseline.md).

### Alerts you can set up in minutes

Alert Settings starts from a template instead of a wall of forms. Each health
check compares its metric to warning and critical thresholds, then routes the
alert to your channels, with severity floors and quiet hours. Custom webhook
targets can be configured through Helm.

<img src="/posts/v0.3.6/alert-settings.webp" alt="Alert Settings page with threshold chart, channel and alert counts, and built-in alerts list" width="2000" height="1250" loading="lazy" />

### Compare hosts and replicas

**Settings Diff** compares `system.settings` and `merge_tree_settings` across
hosts or replica nodes and shows only what differs. **Schema Compare** does the
same for `CREATE TABLE` statements and gives you a copy-only sync script — it
never applies changes.

<img src="/posts/v0.3.6/settings-diff.webp" alt="Settings Diff comparing merge_tree settings across ClickHouse hosts" width="2000" height="1250" loading="lazy" />

### Ask your cluster

The AI agent is wired into the connected host. Ask about schemas, queries,
performance, or health, or start from a suggested question like "Top 10 by
disk" or "Merge queue check". It reads system tables through MCP and works
with free models.

<img src="/posts/v0.3.6/ai-chat.webp" alt="AI chat connected to a ClickHouse host with suggested questions" width="2000" height="1250" loading="lazy" />

### Beyond ClickHouse

Postgres monitoring (beta) and PeerDB CDC sit next to your ClickHouse
clusters. PeerDB now has a full alert cycle — see the
[v0.3.5 + v0.3.6 notes](/v0.3.6/) for the details.

## Upgrading from v0.2

v0.3 moved the dashboard from Next.js to TanStack Start. ClickHouse connection
variables are unchanged. Client `NEXT_PUBLIC_*` variables become `VITE_*`, and
the old names still work as a fallback. Follow
[Migrate to v0.3](https://docs.chmonitor.dev/reference/migrating/v0-3) for the
per-platform steps.

```bash
docker pull ghcr.io/chmonitor/chmonitor:0.3.6
```

## Read more

- [chmonitor v0.3](/v0.3/) — the TanStack Start release
- [chmonitor v0.3.4](/v0.3.4/) — Tools menu, workspace roles, Schema Compare, Settings Diff
- [chmonitor v0.3.5 + v0.3.6](/v0.3.6/) — PeerDB alerting, local CLI, quieter sidebar
- [GitHub release v0.3.6](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.6)
