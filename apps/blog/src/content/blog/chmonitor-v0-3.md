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

## What's landed since launch

v0.3 keeps shipping. Since the initial release:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/posts/v0.3/overview-dark.png">
  <img data-shot="light" src="/posts/v0.3/overview-light.png" alt="Overview page with a GitHub-style query activity heatmap" />
  <img data-shot="dark" src="/posts/v0.3/overview-dark.png" alt="Overview page with a GitHub-style query activity heatmap" />
</picture>

**A year of query activity, at a glance.** The Overview page now has a
calendar heatmap of query volume, failures, memory and duration — the same
glanceable pattern as a GitHub contribution graph.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/posts/v0.3/cluster-insights-dark.png">
  <img data-shot="light" src="/posts/v0.3/cluster-insights-light.png" alt="Cluster Insights page with record breakers and detected findings" />
  <img data-shot="dark" src="/posts/v0.3/cluster-insights-dark.png" alt="Cluster Insights page with record breakers and detected findings" />
</picture>

**Cluster Insights**, a new page: auto-detected findings (error-rate spikes,
latency regressions) plus record breakers — largest scan, fastest scan speed,
longest query, total storage — surfaced without building a single dashboard.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/posts/v0.3/sql-console-dark.png">
  <img data-shot="light" src="/posts/v0.3/sql-console-light.png" alt="SQL Console with query editor, results, EXPLAIN and scan analysis tabs" />
  <img data-shot="dark" src="/posts/v0.3/sql-console-dark.png" alt="SQL Console with query editor, results, EXPLAIN and scan analysis tabs" />
</picture>

**SQL Console**: run read-only SQL with history, one-click EXPLAIN, query log
and scan analysis, without leaving the dashboard for a separate client.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/posts/v0.3/storage-dark.png">
  <img data-shot="light" src="/posts/v0.3/storage-light.png" alt="Storage breakdown by database, table and part" />
  <img data-shot="dark" src="/posts/v0.3/storage-dark.png" alt="Storage breakdown by database, table and part" />
</picture>

**Storage breakdown** by database, table and part, so you know exactly where
the bytes go.

<img src="/posts/v0.3/keeper.png" alt="Keeper page with session, watches, quorum role and per-node stats" />

**ClickHouse Keeper monitoring**: session state, watches, quorum role and
per-node Raft stats for every Keeper node.

<img src="/posts/v0.3/cluster-topology.png" alt="Cluster Topology diagram showing Keeper quorum, ClickHouse nodes and replication links" />

**Cluster Topology**: nodes, shards, replicas, and Keeper quorum drawn as a
live diagram — click any node for an inspector panel with latency, znodes and
virtual cluster membership.

<img src="/posts/v0.3/ai-agent.png" alt="AI Agent chat with suggested questions, connected MCP server and skill toggles" />

**The AI agent**, wired straight into a host: suggested questions by category
(insights, schema, storage, queries), live skill/tool toggles, and an MCP
server already connected — ask about your cluster in plain language.

<img src="/posts/v0.3/data-explorer.png" alt="Data Explorer rendering a table dependency graph with materialized view edges" />

**Data Explorer**: every table in a database rendered as a dependency graph —
materialized views, dictionaries and sources connected by typed edges (`TO`,
`dictGet`, `joinGet`) instead of guessing from `SHOW CREATE TABLE`.

<img src="/posts/v0.3/running-queries.png" alt="Running Queries page with live charts and a table of active queries" />

**Running Queries**, live: active count, memory and per-user breakdown as
charts up top, the actual query table below, auto-refreshing every 5 seconds.

<img src="/posts/v0.3/explain-tree.png" alt="EXPLAIN Query page showing the execution plan as an interactive tree" />

**EXPLAIN as a tree**: pick Plan, Pipeline, AST, Syntax or Estimate, and read
the execution plan as a collapsible tree instead of a wall of text.

<img src="/posts/v0.3/health-audit.png" alt="Generated audit prompt for a critical replication lag health check" />

**Health → audit prompt**: a critical check (replication lag, in this case)
turns into a ready-to-paste prompt with the metric, raw data row, system
tables and common causes — hand it to any AI/coding agent for a diagnosis.

<img src="/posts/v0.3/slow-queries.png" alt="Slow Queries page with an occurrence chart and a sortable table of the slowest finished queries" />

**Slow Queries**: the slowest finished queries from the query log, worst
first, with an occurrence chart and a one-click "Explain top N" for the whole
list.

<img src="/posts/v0.3/peerdb-mirrors.png" alt="PeerDB Mirrors page with mirror status, peer topology and per-mirror pipeline phase" />

**PeerDB Mirrors**: CDC/QRep mirror status, throughput and rows synced across
every source-to-ClickHouse pipeline, plus a live peer topology and per-mirror
pipeline phase breakdown.

<img src="/posts/v0.3/mcp-server.png" alt="MCP Server page with endpoint URL and setup guides for Claude Desktop, Claude Code and Cursor" />

**MCP Server**, self-serve: the endpoint URL plus copy-paste setup for Claude
Desktop, Claude Code, Cursor or any Streamable HTTP MCP client — read-only
access to schemas, queries and performance from your own tooling.

Alerting also grew a **custom alert rule builder** (define your own thresholds
and conditions, not just the built-in health checks) and an **email adapter**
(Mailgun/SendGrid) alongside the existing Slack/Discord webhooks — see
[Alerting to Slack and Discord](https://docs.chmonitor.dev/guide/guides/alerting-slack-discord)
for the webhook walkthrough.

## Migrating to v0.3

v0.3 introduces a few breaking configuration and packaging changes. Follow these steps to upgrade your self-hosted instances:

### 1. Docker Image Name Change
The canonical Docker image name has changed from `duyet/clickhouse-monitoring` to **`chmonitor/chmonitor`** (hosted on GitHub Container Registry). 

Update your `docker-compose.yml` or Kubernetes manifests to pull the new image:
```yaml
image: ghcr.io/chmonitor/chmonitor:latest
```
*(Note: The legacy image name `ghcr.io/duyet/clickhouse-monitoring` remains as an alias pointing to the same build, but it is deprecated and will not receive updates in future major versions.)*

### 2. Helm Chart Updates
The Helm chart repository has been updated. The chart is now published to the OCI registry at `oci://ghcr.io/chmonitor/chmonitor`.

To install or upgrade using the new OCI registry chart:
```bash
helm upgrade --install my-chm oci://ghcr.io/chmonitor/chmonitor --version 0.3.0
```

### 3. Unified Environment Variables
All configuration variables are now unified under the standard `CHM_` prefix (e.g., `CHM_TELEMETRY`, `CHM_DEPLOYMENT_MODE`) instead of duplicate or client/server-specific names. Client variables (`VITE_`) are automatically derived from `CHM_` at build time. Check `apps/dashboard/.env.example` in the repository for the latest environment variable reference.

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
