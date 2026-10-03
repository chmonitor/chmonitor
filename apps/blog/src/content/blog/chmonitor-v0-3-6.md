---
title: "chmonitor v0.3.6 — Less menu. More cluster."
description: "Everything since v0.2 in one place: a sidebar cut from 16 menus to 5 task groups, a faster dashboard, Cloud, Postgres and PeerDB monitoring, alerting, AI, and new compare tools."
date: 2026-10-03
tag: Release
version: v0.3.6
author: duyetbot
cover: /posts/v0.3.6/cover.webp
---

If you last used chmonitor on v0.2, this is the post to read. Since v0.2.16
there have been **95 new features, 179 fixes, and 10 performance
improvements**. Here's the 60-second version.

<figure class="video video-wide">
  <iframe src="https://www.youtube-nocookie.com/embed/n8p4JwNHcGQ?rel=0" title="chmonitor v0.3.6 launch video" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="eager"></iframe>
</figure>

## What's new since v0.2

<div class="hl-grid wide">
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M13 8h4"/><path d="M13 12h4"/></svg></span><b>Cleaner navigation</b><span>From 16 menus and 93 pages to 5 task groups plus More. Customizable per role.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></span><b>Faster</b><span>Cached queries 3.58s → 0.17s, idle polling 132 → 73 req/min, JS 6.9 → 5.0 MB.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg></span><b>Cloud</b><span>A hosted dashboard with a public demo. Docker, Helm, and Cloudflare Workers from one codebase.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg></span><b>Beyond ClickHouse</b><span>Postgres monitoring (beta) and PeerDB CDC with fleet metrics and alerts.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/></svg></span><b>Alerting</b><span>Templates, presets, channels, health reports, and custom webhooks configured through Helm.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/></svg></span><b>AI built in</b><span>An agent, Insights, advisors, an MCP server, and an MCP Playground.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/></svg></span><b>New tools</b><span>Schema Compare, Settings Diff, TTL and partition health, cluster topology, SQL Console.</span></div>
  <div class="hl"><span class="hl-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><b>Workspace roles</b><span>Full, DBA, Engineer, and SRE presets hide the pages a role doesn't need.</span></div>
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
[v0.3.5 notes](/v0.3.5/) for the details.

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
- [chmonitor v0.3.5](/v0.3.5/) — PeerDB alerting, local CLI, quieter sidebar
- [GitHub release v0.3.6](https://github.com/chmonitor/chmonitor/releases/tag/v0.3.6)
