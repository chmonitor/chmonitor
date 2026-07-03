---
title: "chmonitor v0.3 — a full rebuild"
description: "We rebuilt chmonitor from the ground up on TanStack Start: a faster dashboard, an AI agent that talks to your cluster over MCP, query monitoring, a data explorer, cluster topology, AI insights and one-command self-hosting anywhere."
date: 2026-06-29
tag: Release
version: v0.3
---

chmonitor **v0.3** is the biggest release since the project started — a ground-up
rebuild on **TanStack Start**. Everything is new: a faster dashboard, an AI agent
that answers questions about your cluster, live query monitoring, a data
explorer, cluster topology, AI insights, and self-hosting that's a single command
on Cloudflare Workers, Docker or Kubernetes.

Here's the ~28-second launch film — every scene is the real product:

<figure class="video">
  <video src="/posts/v0.3/launch.mp4" poster="/posts/v0.3/launch-poster.png" controls preload="metadata" playsinline></video>
  <figcaption>chmonitor v0.3 — launch film. Dashboard, AI agent, query monitoring, data explorer, topology, health & self-host.</figcaption>
</figure>

v0.3 lands 8 new features, more than 70 fixes, 13 performance wins, and 71 charts.

## Everything that's new

<div class="hl-grid">
  <div class="hl"><b>Rebuilt on TanStack Start</b><span>A static-first shell with client-side data fetching — pages load instantly and cache at the edge.</span></div>
  <div class="hl"><b>AI agent over MCP</b><span>Ask your cluster anything. The agent reads system tables through an MCP server and answers in plain language.</span></div>
  <div class="hl"><b>Live query monitoring</b><span>Watch every running and historical query, sort by cost, and drill into the ones that hurt.</span></div>
  <div class="hl"><b>Data query explorer</b><span>Browse databases, follow the dependency graph, then jump straight into a SQL console.</span></div>
  <div class="hl"><b>AI insights</b><span>Anomalies and regressions surfaced automatically and ranked by severity.</span></div>
  <div class="hl"><b>Metrics & profiler</b><span>CPU, memory and IO alongside ClickHouse profiler events for real root-cause work.</span></div>
  <div class="hl"><b>Query EXPLAIN as a tree</b><span>The EXPLAIN plan rendered as an interactive tree instead of a wall of text.</span></div>
  <div class="hl"><b>Cluster topology</b><span>Nodes, shards, replicas and Keeper quorum drawn as a live diagram.</span></div>
</div>

## Highlights

### A faster dashboard

The whole app moved to **TanStack Start** with a native Cloudflare Workers
bundle. Pages are prerendered as a static shell and hydrate with TanStack Query,
so the first paint is instant and data streams in progressively. Multi-host
routing stays as simple as `?host=0`.

### An AI agent that knows your cluster

The new agent connects over an **MCP server** and can read every system table.
Ask *"why is this query slow?"* or *"what changed in the last hour?"* and it
pulls the metrics, runs the diagnostic SQL, and explains what it found — no more
memorising table names.

### Health, audit and insights

Color-coded cluster **health** rolls up into a ready-made **audit prompt**, while
**AI Insights** continuously scans for anomalies and regressions and ranks them by
severity, so the important things float to the top.

### Self-host anywhere

A v0.3 deploy is one command. Run it on **Cloudflare Workers**, **Docker** or
**Kubernetes** — same codebase, same image, configured entirely through
environment variables.

```bash
docker compose up -d
```

## Breaking changes

v0.3 is a rebuild, so a few things moved:

- **URL structure** changed from `/0/overview` to `/overview?host=0` (static
  routing + edge caching).
- **`fetchData()`** now requires a `hostId` parameter — it used to be optional.
- All data fetching moved **client-side**; there's no SSR data layer anymore.

Since the project has no backwards-compatibility guarantees yet, there's nothing
to migrate other than bookmarks.

## Changelog

| Area | What changed |
| --- | --- |
| Dashboard | Rebuilt on TanStack Start; static shell + TanStack Query; 15+ pages, 71 charts |
| AI agent | New agent over MCP; reads system tables; 29+ tool categories |
| Query monitoring | Live running + historical queries, cost ranking, EXPLAIN tree |
| Data explorer | Database browser, dependency graph, SQL console |
| Insights | AI insights engine — anomalies & regressions ranked by severity |
| Metrics | CPU / memory / IO + ClickHouse profiler events |
| Cluster | Topology diagram — nodes, shards, replicas, Keeper quorum |
| Health | Color-coded health → generated audit prompt |
| Deploy | One-command self-host on Cloudflare Workers / Docker / Kubernetes |
| Performance | 13 perf wins — pooling, memoization, cache limits, hidden-chart unmounting |

See the full commit-level history in the
[GitHub releases](https://github.com/chmonitor/chmonitor/releases).

---

**Try it now:** open the [live dashboard](https://dash.chmonitor.dev), read the
[docs](https://docs.chmonitor.dev), or [star us on GitHub](https://github.com/chmonitor/chmonitor).
