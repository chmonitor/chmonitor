# chmonitor — Product Requirements Document (PRD)

> **Version**: 1.0-draft  
> **Date**: 2026-06-12  
> **Status**: Draft — pending review  
> **Author**: chmonitor team  
> **Scope**: `apps/dashboard` (TanStack Start, v0.3) + platform services

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Core Value Proposition](#3-core-value-proposition)
4. [Product Overview](#4-product-overview)
5. [Current Feature Inventory](#5-current-feature-inventory)
6. [Target Users & Personas](#6-target-users--personas)
7. [Competitive Landscape](#7-competitive-landscape)
8. [Feature Roadmap](#8-feature-roadmap)
   - 8.1 [Dynamic Dashboards](#81-dynamic-dashboards)
   - 8.2 [AI Agent & Smart Monitoring](#82-ai-agent--smart-monitoring)
   - 8.3 [Alert & Event System](#83-alert--event-system)
   - 8.4 [Auto-Discovery & Schema Intelligence](#84-auto-discovery--schema-intelligence)
   - 8.5 [Observability Integrations](#85-observability-integrations)
9. [Monetization Strategy](#9-monetization-strategy)
10. [Technical Architecture](#10-technical-architecture)
11. [Success Metrics](#11-success-metrics)
12. [Appendix](#appendix)

---

## 1. Executive Summary

**chmonitor** is an open-source, edge-deployed monitoring platform purpose-built for ClickHouse — the world's fastest open-source columnar database. It transforms raw ClickHouse system tables into actionable operational intelligence through real-time dashboards, an AI-powered agent, and intelligent alerting.

### The Opportunity

ClickHouse powers analytics at Uber, Cloudflare, Spotify, eBay, and Cisco, yet lacks a **dedicated, opinionated monitoring tool**. Users cobble together Grafana + custom queries, pay for generic observability platforms (Datadog, New Relic), or simply fly blind. No existing solution understands ClickHouse's unique internals — ReplicatedMergeTree, Keeper, merge operations, part logistics — the way a purpose-built tool can.

**chmonitor is that tool.** It's the "pgAdmin for ClickHouse" — but modern, cloud-native, and AI-augmented.

### Core Value

> **chmonitor turns ClickHouse system tables into operational clarity — from "what's happening" to "what to do about it."**

The three pillars of value:

1. **Depth of Insight**: 85 page routes, 80+ query configurations, 30+ AI agent tools — covering queries, merges, replication, Keeper, storage, security, and more. No other tool matches this ClickHouse-specific depth.
2. **Intelligence, not just data**: An AI agent that doesn't just display metrics but *explains* them — "Your merge performance degraded 3x because the batch insert on Tuesday created 10,000 parts." This is qualitative, not quantitative, insight.
3. **Deploy anywhere, monitor everything**: Cloudflare Workers edge (1.8 MiB bundle, ~25ms cold start), Docker, Kubernetes, or bare-metal. Multi-host from day one. Auth-optional or Clerk-managed.

---

## 2. Problem Statement

### For Data Engineers & DBAs

| Pain | Impact | Current Workaround |
|------|--------|-------------------|
| ClickHouse has 100+ system tables — which ones matter? | Information overload; critical signals buried in noise | Manual SQL queries, tribal knowledge |
| Replication lag, stuck merges, disk exhaustion — all silent killers | Incidents discovered too late, data loss risk | Grafana alerts with hand-written SQL |
| Query performance degrades slowly over weeks | "Death by a thousand cuts" — no single event triggers investigation | Periodic manual review of `system.query_log` |
| No unified view across multi-shard, multi-replica clusters | Blind spots between shards; incomplete picture | SSH into each node, run `clickhouse-client` |
| ClickHouse version upgrades change available system tables | Monitoring dashboards break silently | Manual migration per version |

### For Teams & Organizations

| Pain | Impact |
|------|--------|
| No ClickHouse-specific SaaS monitoring | Teams build internal dashboards (expensive, unmaintained) |
| Generic DB monitors miss ClickHouse internals | Missed replication lag, stuck mutations, Keeper issues |
| No AI-powered root cause analysis | Mean-time-to-resolution measured in hours, not minutes |
| Alert fatigue from generic threshold monitors | Engineers ignore alerts, miss real incidents |

---

## 3. Core Value Proposition

### What chmonitor Does That Nothing Else Does

```
┌─────────────────────────────────────────────────────────────────┐
│                     chmonitor VALUE STACK                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LAYER 4: ACTION         AI Agent → "Kill this query"          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ LAYER 3: INTELLIGENCE   Anomaly detection + root cause  │   │
│  │ ┌─────────────────────────────────────────────────────┐ │   │
│  │ │ LAYER 2: CONTEXT       Cluster topology + history   │ │   │
│  │ │ ┌─────────────────────────────────────────────────┐ │ │   │
│  │ │ │ LAYER 1: VISIBILITY    80+ query configs, 30+   │ │ │   │
│  │ │ │                         charts, 85 routes       │ │ │   │
│  │ │ └─────────────────────────────────────────────────┘ │ │   │
│  │ └─────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Layer 1 — Visibility** (shipped): System table → structured view. 85 pages, 80+ query configs, 30+ chart components. Every ClickHouse system table that matters has a view.

**Layer 2 — Context** (shipped): Multi-host, cluster topology, Keeper status. Understanding *relationships* — which queries hit which tables, which replicas lag behind which shard.

**Layer 3 — Intelligence** (partially shipped): AI agent with 32 tool categories. Anomaly detection, health sweeps, root-cause analysis. Transforms data into narrative.

**Layer 4 — Action** (in progress): Alert dispatch, webhook integration, cron health sweeps, query kill. Moving from "observe" to "remediate."

---

## 4. Product Overview

### Platform Architecture

```
┌──────────────────────────────────────────────────────┐
│                   chmonitor Platform                  │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  dashboard   │  │   MCP Server │  │  AI Agent   │ │
│  │  (TSR/app)   │  │  /api/mcp    │  │  /api/v1/   │ │
│  │  85 routes   │  │  12+ tools   │  │  agent      │ │
│  │  30+ charts  │  │  Streamable  │  │  32 tools   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                  │        │
│         └─────────────────┼──────────────────┘        │
│                           │                            │
│              ┌────────────┴────────────┐               │
│              │    API Layer            │               │
│              │    /api/v1/* (53 routes)│               │
│              └────────────┬────────────┘               │
│                           │                            │
│              ┌────────────┴────────────┐               │
│              │  @chm/clickhouse-client │               │
│              │  Multi-host, versioned  │               │
│              └────────────┬────────────┘               │
│                           │                            │
│         ┌─────────────────┼─────────────────┐          │
│         │                 │                  │          │
│    ┌────┴────┐    ┌──────┴──────┐    ┌─────┴────┐    │
│    │ CH Node │    │ CH Node     │    │ CH Node  │    │
│    │ (shard) │    │ (replica)   │    │ (keeper) │    │
│    └─────────┘    └─────────────┘    └──────────┘    │
│                                                      │
│  Deployment: Cloudflare Workers | Docker | K8s        │
│  Bundle: 1.8 MiB gzip | Cold start: ~25ms            │
└──────────────────────────────────────────────────────┘
```

### Technology Stack (apps/dashboard)

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | TanStack Start (TanStack Router) | File-based routing, SSR-capable, Vite-native |
| Rendering | Static prerender + client SPA | Edge-cached shell, dynamic data via TanStack Query |
| Data Tables | TanStack Table + react-virtual | Virtualized rows, column resize, custom formatters |
| Charts | Recharts 3.x + custom primitives | Area, bar, progress, donut, heatmap, topology |
| Styling | Tailwind v4 + shadcn/ui | Utility-first, CSS-first config, accessible primitives |
| AI | Vercel AI SDK + assistant-ui | Streaming chat, tool loops, multi-provider |
| Deployment | Cloudflare Workers (workerd) | Edge, 3 MiB limit, D1/KV bindings |
| Auth | Pluggable: none / Clerk / proxy header | Optional, build-time gated |
| Database | ClickHouse (monitoring target) + D1 (app state) | System tables for metrics, D1 for settings/history |

### Key Metrics (Current)

| Metric | Value |
|--------|-------|
| Page routes | 85 |
| API routes | 53 |
| Query configurations | 80+ |
| Chart components | 30+ |
| AI agent tools | 32 categories |
| MCP tools | 12+ |
| Health checks | Built-in (readonly replicas, disk space, merge lag, etc.) |
| Worker bundle (gzip) | 1,793 KiB |
| Build time | ~9 seconds |
| Cold start | ~25ms |

---

## 5. Current Feature Inventory

### 5.1 Query Monitoring

| Feature | Route | Description |
|---------|-------|-------------|
| Running queries | `/running-queries` | Live view of currently executing queries |
| Query history | `/history-queries` | Historical query log with filtering |
| Failed queries | `/failed-queries` | Queries that errored, with error messages |
| Common errors | `/common-errors` | Grouped error patterns and frequencies |
| Expensive queries (time) | `/expensive-queries` | Top queries by execution time |
| Expensive queries (memory) | `/expensive-queries-by-memory` | Top queries by memory consumption |
| Slow queries | `/slow-queries` | Queries exceeding slow thresholds |
| Query profiler | `/profiler` | Stack-trace profiling for query performance |
| Query detail | `/query?id=` | Single query deep-dive with EXPLAIN |
| EXPLAIN | `/explain` | Visual EXPLAIN plan tree |
| Query cache | `/query-cache` | Query cache hit rates and usage |
| Query metric log | `/query-metric-log` | Detailed per-query metrics over time |
| Query parallelization | `/queries/parallelization` | Query parallel execution analysis |
| Thread analysis | `/queries/thread-analysis` | Thread-level query execution breakdown |
| Query views log | `/query-views-log` | Materialized view execution log |
| Query insights | `/insights` | Aggregated query insights and analysis |
| SQL Console | `/sql` | Interactive SQL editor with execution |

### 5.2 Merge & Replication

| Feature | Route | Description |
|---------|-------|-------------|
| Merge operations | `/merges` | Active and recent merges |
| Merge performance | `/merge-performance` | Merge speed, parts merged, time trends |
| Mutations | `/mutations` | ALTER TABLE mutation tracking |
| Moves | `/moves` | Data part move operations |
| Detached parts | `/detached-parts` | Detached but not dropped parts |
| Replication queue | `/replication-queue` | Pending replication tasks |
| Replicas status | `/clusters/replicas-status` | Replica health across cluster |
| Replicated fetches | `/replicated-fetches` | Data fetch progress between replicas |
| Replicated settings | `/replicated-merge-tree-settings` | Replication-specific settings |
| Distributed DDL | `/distributed-ddl-queue` | Distributed DDL task queue |
| Replicas | `/replicas` | Per-table replica status and lag |

### 5.3 Tables & Storage

| Feature | Route | Description |
|---------|-------|-------------|
| Data explorer | `/explorer` | Tree browser: databases → tables → columns |
| Tables overview | `/tables-overview` | Size, rows, compression across all tables |
| Part info | `/part-info` | Individual data part details |
| Part log | `/part-log` | Part lifecycle events |
| Disks | `/disks` | Storage disk usage and configuration |
| Backups | `/backups` | Backup status (if backup_log enabled) |
| Dropped tables | `/dropped-tables` | Recently dropped tables |
| Projections | `/projections` | Projection definitions and usage |
| MergeTree settings | `/mergetree-settings` | Per-table MergeTree settings |
| Dictionaries | `/dictionaries` | Dictionary status and refresh |
| Top usage tables | `/top-usage-tables` | Tables ranked by resource usage |
| Top usage columns | `/top-usage-columns` | Columns ranked by access frequency |
| Readonly tables | `/readonly-tables` | Tables in readonly mode |
| View refreshes | `/view-refreshes` | Materialized view refresh history |

### 5.4 Cluster & System

| Feature | Route | Description |
|---------|-------|-------------|
| Cluster overview | `/clusters` | Shards, replicas, topology (includes interactive SVG topology diagram) |
| Metrics | `/metrics` | System metrics table |
| Async metrics | `/asynchronous-metrics` | Background metric snapshots |
| Settings | `/settings` | ClickHouse configuration settings |
| Users | `/users` | system.user accounts |
| Roles | `/roles` | system.role definitions |
| Health | `/health` | Automated health checks + AI audit |
| Kafka consumers | `/kafka-consumers` | Kafka consumption lag and status |
| Dashboard | `/dashboard` | Customizable chart dashboard |
| Chart browser | `/charts` | Browse all available chart widgets |
| Page views | `/page-views` | Monitoring events and page view tracking |

### 5.5 ClickHouse Keeper

| Feature | Route | Description |
|---------|-------|-------------|
| Keeper overview | `/keeper` | Keeper cluster health |
| Keeper connections | `/keeper/connections` | Active Keeper connections |
| Keeper watches | `/keeper/watches` | Watch count and distribution |
| Keeper log | `/keeper/log` | Keeper request log |
| Keeper connection log | `/keeper/connection-log` | Connection history |
| Keeper info | `/keeper/info` | Keeper server info |
| Keeper presence | `/keeper/overview` | Keeper node presence |

### 5.6 Logs & Diagnostics

| Feature | Route | Description |
|---------|-------|-------------|
| Text log | `/logs/text-log` | ClickHouse text log entries |
| Crashes | `/logs/crashes` | Crash log with stack traces |
| Stack traces | `/logs/stack-traces` | Live stack trace sampling |
| Errors | `/errors` | system.error_log entries |
| Warnings | `/warnings` | system.warnings entries |

### 5.7 Security

| Feature | Route | Description |
|---------|-------|-------------|
| Sessions | `/security/sessions` | Active user sessions |
| Login attempts | `/security/login-attempts` | Authentication audit |
| Audit log | `/security/audit-log` | Security event log |

### 5.8 AI & Intelligence

| Feature | Route | Description |
|---------|-------|-------------|
| AI Agent Chat | `/agents` | Full AI agent with 32 tool categories |
| AI Chat (simple) | `/ai-chat` | Lightweight chat interface |
| MCP Server | `/api/mcp` | Model Context Protocol endpoint |
| Health audit | `/health` | AI-powered health audit with findings |

**AI Agent Tool Categories** (32):
anomaly, ask-user, capacity, cluster, comparison, context, control, dashboard, diagnostics, finding, health, incident, insights, log, merge, migration, optimizer, plan, query, replication, report, schema, security, settings, skill, sql-analysis, storage, visualization, workflow, zookeeper

### 5.9 Infrastructure

| Feature | Implementation |
|---------|---------------|
| Multi-host support | Comma-separated env vars, `?host=N` routing |
| Auth | Pluggable: none / Clerk / proxy header |
| Cron health sweep | `/api/cron/health-sweep` (5-min intervals) |
| Alert dispatch | Webhook + browser notifications |
| Health checks | 7 built-in checks (readonly replicas, disk space, etc.) |
| Security headers | CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy |
| Table validation | Auto-detect optional table existence |
| Version-aware queries | `since` field for ClickHouse version compatibility |

### 5.10 Integrations

| Feature | Route | Description |
|---------|-------|-------------|
| PeerDB overview | `/peerdb` | PeerDB integration dashboard |
| PeerDB mirrors | `/peerdb/mirror` | Mirror status and configuration |
| PeerDB peer detail | `/peerdb/peer` | Individual peer details |
| PeerDB peers | `/peerdb/peers` | All configured peers |

### 5.11 Other Routes

| Feature | Route | Description |
|---------|-------|-------------|
| About | `/about` | Application info and version |
| MCP docs | `/mcp` | MCP server documentation |
| Table explorer | `/table` | Explorer handler for table detail views |
| User processes | `/user-processes` | Process list grouped by user |
| Docs | `/docs` | Documentation site (catch-all route) |

---

## 6. Target Users & Personas

### Primary: Data Engineer / DBA

- **Manages**: 1–50 ClickHouse nodes
- **Needs**: Query performance, replication health, capacity planning
- **Pain**: ClickHouse system tables are powerful but complex; no unified view
- **Value**: Instant visibility into cluster health without writing SQL

### Secondary: SRE / DevOps

- **Manages**: Infrastructure reliability for ClickHouse-backed services
- **Needs**: Alerts, SLOs, incident response, capacity forecasting
- **Pain**: Generic monitors miss ClickHouse-specific failure modes
- **Value**: ClickHouse-aware alerting with root-cause context

### Tertiary: Analytics Engineer

- **Manages**: Data pipelines, materialized views, dictionaries
- **Needs**: Query optimization, pipeline monitoring, data freshness
- **Pain**: No easy way to see which queries are slow and why
- **Value**: AI-powered optimization suggestions

### Enterprise: Team Lead / CTO

- **Manages**: Team productivity, cost efficiency, vendor evaluation
- **Needs**: Multi-cluster overview, cost tracking, compliance audit
- **Pain**: No visibility into ClickHouse operational spend
- **Value**: Executive dashboards, cost attribution, access control

---

## 7. Competitive Landscape

### 7.1 ClickHouse Native Capabilities

ClickHouse ships powerful raw monitoring data but provides minimal tooling to use it.

#### Built-in System Tables (80+ tables)

ClickHouse exposes monitoring through three tiers of real-time metric tables:

| Tier | Table | What it provides | Limitations |
|------|-------|-----------------|-------------|
| Instant gauges | `system.metrics` | 120+ point-in-time metrics (Query, Merge, MemoryTracking, HTTPConnection, ReplicatedFetch, ReadonlyReplica, DelayedInserts…) | Snapshot only, no history, resets on restart |
| Cumulative counters | `system.events` | Lifetime counters (total SELECTs, INSERTs, bytes read/written, network sends, cache hits) | Resets on restart, no time-series without external storage |
| Periodic background | `system.asynchronous_metrics` | 200+ metrics: CPU per core, memory breakdown, per-disk usage, network I/O, replication delays, thread pools | Some update only every 120s, not a full time-series |

**Historical log tables** (configurable, some disabled by default):

| Table | Purpose | Default |
|-------|---------|---------|
| `system.query_log` | 60+ columns per query: text, timing, resources, errors, profile events | Enabled |
| `system.part_log` | MergeTree part lifecycle: merges, mutations, moves, downloads | Configurable |
| `system.metric_log` | Periodic snapshots of `metrics` + `events` | **Disabled** |
| `system.query_metric_log` | Per-query metric history | **Disabled** |
| `system.trace_log` | Query profiling stack traces | Enabled |
| `system.text_log` / `system.error_log` / `system.crash_log` | Server logs, errors, crashes | Mixed |
| `system.processes` | Currently running queries (live) | Always available |
| `system.replicas` / `system.replication_queue` | Replication status per table | Always available |
| `system.merges` / `system.mutations` | Active background operations | Always available |

**Key insight**: ClickHouse intentionally provides the data layer but delegates visualization, alerting, and operational intelligence to external tools. This is precisely the gap chmonitor fills.

#### Built-in Dashboard (`/dashboard`)

A single-page observability view with 14 real-time charts (QPS, CPU, merges, memory, disk I/O, parts count). No navigation, no drill-down, no query analysis, no historical data, no alerting, no multi-host. Adequate for a quick health check, not for production monitoring.

#### `clickhouse-local`

A zero-install CLI running the full ClickHouse SQL engine against local/remote files. Powerful for ad-hoc diagnostics, but terminal-only — no dashboard, no alerting, no periodic collection, no visualization.

#### Export Integrations

- **Prometheus endpoint** (`/metrics`): Exposes `system.metrics`, `system.events`, `system.asynchronous_metrics` in Prometheus format. Requires external Prometheus server + Grafana.
- **Graphite export**: Pushes metrics to Graphite at configurable intervals.
- **HTTP health**: `/ping` (200 OK) and `/replicas_status` (200 if healthy, 503 if lagging).
- **OpenTelemetry**: Trace span capture via `system.opentelemetry_span_log`.

#### Keeper Monitoring

Four-letter commands (`mntr`, `stat`, `ruok`, `cons`, `wchs`) similar to ZooKeeper, plus `system.zookeeper` (tree read) and `system.zookeeper_log` (request/response log). No built-in visualization.

#### What ClickHouse Does NOT Provide

- No multi-page monitoring dashboard
- No query analysis UI (slow query identification, fingerprint trending)
- No alerting system
- No cluster topology visualization
- No merge/mutation performance tracking UI
- No AI-powered insights or root-cause analysis
- No capacity planning or prediction tools
- No MCP or AI agent integration

### 7.2 Generic Observability Platforms

| Tool | Type | Strengths | Weaknesses |
|------|------|-----------|------------|
| **Grafana + ClickHouse plugin** | OSS/Cloud | Flexible dashboards, huge ecosystem, community templates | Manual dashboard building required; generic — not CH-specific; no understanding of ReplicatedMergeTree, Keeper, merge operations; alert rules need hand-written SQL |
| **Datadog** | Commercial ($23/host/mo+) | Full-stack observability, APM, log management | Expensive; generic DB monitoring; shallow ClickHouse coverage (basic metrics only); no system table depth |
| **New Relic** | Commercial | APM + infrastructure monitoring | Generic DB monitoring; no ClickHouse-specific internals |
| **Prometheus + AlertManager** | OSS | Industry standard, powerful query language (PromQL) | Metrics only (no query log analysis, no merge tracking); requires ClickHouse exporter; manual alert rule authoring |
| **ClickHouse Cloud Console** | SaaS | Zero-config, integrated with managed service | Cloud-only; limited depth; not available for self-hosted ClickHouse |

### 7.3 Open-Source ClickHouse Tools

| Tool | Status | What it does | Gap vs chmonitor |
|------|--------|-------------|-----------------|
| **Tabix** | Stale (low activity) | Basic web UI for ClickHouse: query editor, table browser | No monitoring, no dashboards, no alerting, no AI |
| **HouseOps** | Abandoned | Basic ClickHouse OPS tool | Unmaintained, limited features |
| **LightHouse** | Stale | Simple ClickHouse monitoring page | Single page, no depth, no alerting, no AI |
| **clickhouse-exporter** (Prometheus) | Active | Exports ClickHouse metrics to Prometheus | Metrics only, requires full Prometheus+Grafana stack |
| **clickhouse-operator** (Altinity) | Active | K8s operator with basic metrics | Operational tool, not a monitoring dashboard |

**Key finding**: No active, comprehensive, purpose-built ClickHouse monitoring dashboard exists in the open-source ecosystem. The space is essentially uncontested.

### 7.4 Database-Specific Monitoring (Analogues)

| Tool | For | Lesson for chmonitor |
|------|-----|---------------------|
| **pgAdmin / pgDash** | PostgreSQL | Purpose-built tools win over generic platforms; pgAdmin is the standard entry point |
| **PMM (Percona)** | MySQL/MongoDB | Open-core model works; SaaS tier for managed; deep engine-specific insights build trust |
| **MongoDB Compass** | MongoDB | Visual query builder + schema explorer is the killer feature; proves "native understanding" matters |
| **RedisInsight** | Redis | Memory analysis and command inspection built trust; tool provided by the database vendor itself |
| **Prisma Studio** | Prisma | Lightweight, visual, zero-config data browser; proves "instantly useful" beats "infinitely configurable" |

### 7.5 chmonitor's Competitive Moat

| Moat | Description | Defensibility |
|------|-------------|---------------|
| **ClickHouse-specific depth** | 80+ query configs, 85 page routes covering ReplicatedMergeTree, Keeper, merge operations, part logistics, replication — no other tool matches this depth | High — requires deep ClickHouse expertise to replicate |
| **AI-native intelligence** | 32 agent tool categories deeply integrated with ClickHouse system tables; not "AI bolted on" but AI as a core capability | High — competitor would need equivalent tool ecosystem |
| **Edge-deployed performance** | 1.8 MiB bundle, ~25ms cold start on Cloudflare Workers — faster than any Grafana instance or self-hosted dashboard | Medium — technical advantage, replicable with effort |
| **MCP server** | First ClickHouse tool with native MCP — integrates with Claude, Cursor, and any AI coding tool | Medium — first-mover advantage in AI tool integration |
| **Open-source trust** | Apache 2.0, auditable, self-hostable; community contribution and adoption funnel | High — trust compounds over time |
| **Deploy anywhere** | Cloudflare Workers, Docker, Kubernetes, bare-metal, Vercel — widest deployment surface | Medium — breadth is hard to match but not unique |

**The core moat**: ClickHouse-specific domain expertise encoded into 80+ query configurations, 32 AI agent tools, and 10 health checks. No generic tool (Grafana, Datadog) can replicate this depth without equivalent ClickHouse expertise. No other ClickHouse-specific tool exists with this breadth.

---

## 8. Feature Roadmap

### 8.1 Dynamic Dashboards

**Status**: Partially shipped (dashboard page + settings API exist)
**Priority**: P1
**Target**: Q3 2026

**Vision**: Users can create, customize, and share dashboards tailored to their specific ClickHouse workload — without writing code or SQL.

#### Feature Breakdown

| Feature | Priority | Complexity | Description |
|---------|----------|------------|-------------|
| Widget types (chart, table, stat, text) | P1 | M | Foundation for all custom dashboards |
| Drag-and-drop grid layout | P1 | M | `@dnd-kit` already in dependencies |
| Time-range sync across widgets | P1 | S | Share a single time-range context |
| Save/share dashboards (URL + JSON) | P1 | M | D1 storage, URL-based sharing |
| Dashboard templates | P2 | S | Pre-built: "Replication Health", "Query Performance" |
| AI-generated dashboards | P2 | L | "Show me all queries scanning >1B rows" → auto-build |
| Auto-suggested views | P2 | M | Detect cluster topology → suggest relevant dashboards |
| Team library | P3 | M | Shared dashboard catalog per organization |

#### User Stories

- As a DBA, I want to create a dashboard that shows replication lag for all my shards side-by-side so I can spot issues at a glance.
- As an SRE, I want to save my dashboard and share the URL with my team so we all see the same view.
- As a data engineer, I want the AI to build a dashboard from my natural language description so I don't have to manually configure 10 widgets.
- As a team lead, I want to browse pre-built dashboard templates so I can get started in minutes, not hours.

---

### 8.2 AI Agent & Smart Monitoring

**Status**: Partially shipped (32 tool categories, chat UI, MCP server)  
**Priority**: P0 (core differentiator)  
**Target**: Continuous enhancement

#### Current AI Capabilities (Shipped)

| Category | Tools | Status |
|----------|-------|--------|
| Query analysis | query-tools, sql-analysis, optimizer-tools | ✅ Shipped |
| Anomaly detection | anomaly-tools, health-tools | ✅ Shipped |
| Cluster intelligence | cluster-tools, comparison-tools, capacity-tools | ✅ Shipped |
| Incident management | incident-tools, finding-tools | ✅ Shipped |
| Schema exploration | schema-tools, context-tools | ✅ Shipped |
| Storage analysis | storage-tools, merge-tools | ✅ Shipped |
| Visualization | visualization-tools, dashboard-tools | ✅ Shipped |
| Reporting | report-tools, plan-tools | ✅ Shipped |
| Workflow automation | workflow-tools, control-tools | ✅ Shipped |
| Security | security-tools, settings-tools | ✅ Shipped |

#### Planned AI Enhancements

| Feature | Priority | Complexity | Description |
|---------|----------|------------|-------------|
| Proactive analysis | P0 | M | Agent auto-surfaces insights without being asked |
| Baseline learning | P0 | L | Learn what's "normal" per metric per cluster |
| Predictive alerts | P1 | L | "Disk fills in 6 hours at current rate" |
| Weekly health reports | P1 | M | Auto-generated cluster health narrative |
| SQL optimization suggestions | P1 | M | Before/after EXPLAIN with cost estimates |
| Natural language dashboards | P2 | XL | "Show me..." → auto-built dashboard |
| Anomaly narration | P1 | M | "CPU spike at 14:32 correlated with INSERT from shard-3" |
| Seasonal awareness | P2 | L | Weekend vs weekday pattern recognition |
| Capacity planning projections | P2 | M | Disk fill rate, memory trends, query growth |
| Multi-cluster comparison | P2 | M | Compare metrics across ClickHouse clusters |

---

### 8.3 Alert & Event System

**Status**: Foundation shipped (cron sweep, webhook, browser notifications)  
**Priority**: P0  
**Target**: Q3 2026

#### Current Alert Capabilities (Shipped)

- ✅ Cron health sweep (`/api/cron/health-sweep`) — runs every 5 minutes
- ✅ 7 built-in health checks (readonly replicas, disk space, merge lag, etc.)
- ✅ Severity classification (`ok` / `warning` / `critical`)
- ✅ Webhook dispatch (`fireWebhook`)
- ✅ Browser notifications (`fireBrowserNotification`)
- ✅ In-app alerts (CustomEvent bus)
- ✅ Configurable thresholds (localStorage + env vars)
- ✅ Alert settings UI (health-settings-dialog)
- ✅ Dismissed notification tracking

#### Planned Alert Enhancements

| Feature | Priority | Complexity | Description |
|---------|----------|------------|-------------|
| **Multi-channel alerting** | | | |
| Slack integration | P0 | M | Incoming webhook + bot with rich formatting |
| Email alerts | P0 | M | Via Cloudflare Email Workers or Resend |
| Telegram bot | P1 | S | Telegram bot API integration |
| Discord webhook | P1 | S | Discord webhook format |
| PagerDuty / Opsgenie | P1 | M | ITSM integration for on-call teams |
| SMS (Twilio) | P2 | M | Critical alerts via SMS |
| Mobile push | P2 | L | Web Push API or FCM |
| **Rule engine** | | | |
| Threshold rules | P0 | S | `if metric > X then alert` |
| Rate-of-change rules | P0 | M | `if queries/sec doubled in 5min then alert` |
| Compound rules | P1 | M | `if CPU > 80% AND disk > 90% then alert` |
| Visual rule builder | P2 | XL | Drag-and-drop rule composition |
| Rule DSL (YAML/JSON) | P1 | M | Declarative rule definitions |
| Per-entity granularity | P1 | M | Per-host, per-cluster, per-database, per-table |
| **Event bus** | | | |
| Cloudflare Queues integration | P1 | L | Reliable event processing at edge |
| Event aggregation | P1 | M | Group related alerts, prevent spam |
| Maintenance windows | P1 | S | Suppress alerts during planned changes |
| Alert snooze | P2 | S | Temporarily suppress specific alerts |
| **Smart alerting (AI)** | | | |
| AI-enriched alerts | P1 | M | Add root-cause context to every alert |
| Correlation engine | P2 | L | "CPU spike correlates with merge on table X" |
| Predictive alerts | P2 | L | "Disk will fill in 6 hours" |
| **On-call / Incident** | | | |
| Escalation policies | P2 | M | Alert → on-call → backup → manager |
| On-call schedules | P2 | L | Calendar-based rotation |
| Incident timeline | P3 | M | Chronological incident view |
| Post-mortem templates | P3 | S | AI-generated incident reports |

#### Alert Rule Examples

```yaml
# Example alert rule definitions
rules:
  - name: "High CPU Usage"
    type: threshold
    metric: "system.asynchronous_metrics.CurrentMetric_QueryProfiler"
    condition: "value > 80"
    duration: "5m"
    severity: warning
    channels: [slack, email]
    
  - name: "Replication Lag Spike"
    type: rate_of_change
    metric: "system.replicas.absolute_delay"
    condition: "rate_5m > 2x"
    severity: critical
    channels: [slack, pagerduty]
    
  - name: "Disk Filling Up"
    type: predictive
    metric: "system.disks.free_space"
    condition: "predict_fill_time < 24h"
    severity: warning
    channels: [slack, email]
```

---

### 8.4 Auto-Discovery & Schema Intelligence

**Status**: Partial (explorer tree browser exists)  
**Priority**: P1  
**Target**: Q3-Q4 2026

| Feature | Priority | Complexity | Description |
|---------|----------|------------|-------------|
| Auto-discover databases/tables | P1 | S | Scan `system.databases`, `system.tables` on first connect |
| Auto-detect cluster topology | P1 | M | Detect shards, replicas, Keeper from `system.clusters` |
| Schema change tracking | P1 | M | Log ALTER TABLE, CREATE/DROP events |
| Query fingerprint trending | P1 | M | Track which queries are getting slower over time |
| Smart baseline | P1 | L | Auto-learn "normal" per metric per cluster |
| Capacity projections | P2 | M | Disk fill rate, memory usage trends |
| Schema ERD visualization | P2 | L | Entity-relationship diagram for databases |
| Visual query builder | P2 | XL | Drag columns, filters, aggregations |

---

### 8.5 Observability Integrations

**Status**: MCP server shipped  
**Priority**: P1-P2  
**Target**: Q3-Q4 2026

| Feature | Priority | Complexity | Description |
|---------|----------|------------|-------------|
| Prometheus `/metrics` endpoint | P1 | M | Export key metrics in Prometheus exposition format |
| AlertManager webhook receiver | P1 | M | Receive and display Prometheus alerts |
| Grafana dashboard export | P2 | M | Export chmonitor views as Grafana JSON |
| OpenTelemetry traces | P2 | L | Query-level distributed tracing |
| Cloudflare Analytics integration | P2 | S | Worker analytics, cache hit rates |
| Webhook event bus (outbound) | P1 | M | Fire webhooks on any event (configurable) |
| Webhook receiver (inbound) | P2 | M | Accept external events into the event bus |

---

## 9. Monetization Strategy

### 9.1 Open-Core Model

**Principle**: The core monitoring dashboard remains open-source (Apache 2.0). Commercial value comes from cloud-hosted convenience, team features, AI usage, and enterprise integrations.

**What stays open-source:**
- All 85 page routes, 80+ query configs, 30+ charts
- AI agent core (chat, tools)
- MCP server
- Multi-host support
- Basic alerting (webhook, browser notifications)
- Docker/K8s deployment

**What's commercial (cloud/SaaS):**
- Cloud-hosted dashboard (no self-hosting needed)
- Team/organization management
- Advanced alerting (Slack, PagerDuty, SMS, email)
- AI usage beyond free tier
- Dashboard sharing and team library
- Audit log export / compliance
- SSO / SAML
- Priority support / SLA
- Custom branding / white-label

### 9.2 Pricing Tiers

| | Free (OSS) | Pro ($29/user/mo) | Enterprise (custom) |
|---|---|---|---|
| **Monitoring** | Unlimited | Unlimited | Unlimited |
| **Hosts** | Unlimited | Unlimited | Unlimited |
| **Users** | 1 | Up to 10 | Unlimited |
| **AI Agent** | 50 queries/mo | 1,000 queries/mo | Unlimited |
| **Alerts** | Webhook + browser | + Slack, Email, Discord | + PagerDuty, SMS, custom |
| **Dashboards** | Static (85 built-in) | + Custom dashboards | + Team library, templates |
| **Retention** | 7 days | 30 days | Unlimited |
| **Auth** | None / Clerk (self-host) | Clerk (managed) | SSO / SAML |
| **Support** | GitHub Issues | Email + Slack | Dedicated + SLA |
| **Deploy** | Self-host only | Self-host or Cloud | Cloud or on-premise |

### 9.3 Revenue Streams

1. **SaaS subscriptions** — Primary revenue. Pro and Enterprise tiers.
2. **AI usage billing** — Per-query or per-token for AI agent (marginal cost passes through LLM provider).
3. **Managed hosting** — chmonitor.cloud: connect your ClickHouse, we run the dashboard.
4. **Enterprise features** — SSO, audit exports, custom integrations.
5. **Priority support contracts** — SLA-backed support for production deployments.
6. **Marketplace** (future) — Community query packs, dashboard templates, alert rules.

### 9.4 Revenue Projections (12-month)

| Scenario | Free Users | Paid Users | MRR | ARR |
|----------|-----------|------------|-----|-----|
| Conservative | 500 | 20 | $580 | $6,960 |
| Moderate | 2,000 | 100 | $2,900 | $34,800 |
| Optimistic | 10,000 | 500 | $14,500 | $174,000 |

*Assumptions: $29/user/mo avg, 2-5% conversion rate, 12-month ramp.*

### 9.5 Go-to-Market Strategy

**Phase 1 — Adoption (Months 1-3)**
- Open-source growth: GitHub stars, ClickHouse community, blog posts
- "Deploy to Cloudflare" one-click button (already exists)
- Integration with ClickHouse documentation
- Conference talks (ClickHouse meetup, Percona Live)

**Phase 2 — Conversion (Months 4-6)**
- Launch chmonitor.cloud (managed SaaS)
- Free tier → Pro upsell via AI usage limits
- Team features as conversion driver
- Case studies from early adopters

**Phase 3 — Enterprise (Months 7-12)**
- Enterprise tier with SSO, audit, SLA
- Partner with ClickHouse Inc. (official integration?)
- On-premise enterprise deployment option
- Channel partnerships (managed service providers)

---

## 10. Technical Architecture

### 10.1 Monorepo Structure

```
clickhouse-monitor/
├── apps/
│   ├── dashboard/         # TanStack Start dashboard (primary, v0.3+)
│   ├── landing/           # chmonitor.dev marketing site (Astro)
│   ├── docs/              # docs.chmonitor.dev documentation site
│   └── mcp/               # Standalone MCP worker
├── packages/
│   ├── clickhouse-client/ # @chm/clickhouse-client (shared CH client)
│   ├── logger/            # @chm/logger (shared logging)
│   └── ...                # Other shared packages
├── docs/                  # Knowledge graph + schema docs
└── deploy/                # Helm charts, Docker Compose
```

### 10.2 apps/dashboard Architecture

```
src/
├── routes/                # TanStack Router file-based routing
│   ├── (dashboard)/       # 85 page routes (prerendered static)
│   │   ├── overview.tsx
│   │   ├── running-queries.tsx
│   │   ├── explorer.tsx
│   │   └── ...
│   ├── api/               # 53 API routes (worker-side)
│   │   ├── v1/            # Data endpoints
│   │   └── cron/          # Cron triggers
│   └── (docs)/            # Documentation routes
├── components/            # ~100+ React components
│   ├── charts/            # 30+ chart components
│   ├── data-table/        # Advanced table system
│   ├── agents/            # AI chat UI
│   ├── health/            # Health check cards + settings
│   └── ...
├── lib/
│   ├── ai/agent/          # AI agent core
│   │   ├── tools/         # 32 tool categories
│   │   ├── skills/        # Dynamic skill loading
│   │   └── workflows/     # Agent workflow definitions
│   ├── query-config/      # 80+ QueryConfig definitions
│   ├── health/            # Health sweep + alert dispatch
│   ├── auth/              # Pluggable auth providers
│   └── ...
└── hooks/                 # Custom React hooks
```

### 10.3 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Static-first rendering | Prerender all pages, client-side data | Edge-cached shell, ~25ms cold start, no SSR per request |
| TanStack Query over SWR | Migration choice | Better devtools, mutation support, persistence |
| Pluggable auth | none / clerk / proxy | Maximum flexibility: self-hosted needs no auth, cloud needs full auth |
| D1 for app state | Cloudflare D1 | Edge-deployed, zero-config, serverless SQLite |
| Vercel AI SDK | Agent framework | Streaming, multi-provider, tool loops |
| Bundle stubbing | Heavy libs stubbed from worker bundle | Stay under 3 MiB Cloudflare Workers limit |

---

## 11. Success Metrics

### Product Metrics

| Metric | Current | 6-Month Target | 12-Month Target |
|--------|---------|----------------|-----------------|
| GitHub stars | ~500 | 2,000 | 5,000 |
| Monthly active installs | ~100 | 500 | 2,000 |
| AI agent queries/month | ~1,000 | 10,000 | 100,000 |
| Cloud (SaaS) signups | 0 | 100 | 1,000 |
| Paid subscribers | 0 | 20 | 200 |
| MRR | $0 | $580 | $14,500 |

### Quality Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Build time | ~9s | <10s |
| Cold start | ~25ms | <30ms |
| Worker bundle | 1.8 MiB | <2.5 MiB |
| Test coverage | ~85% | >90% |
| Lighthouse (perf) | ~95 | >95 |
| Uptime (SLA) | ~99.9% | 99.95% |

---

## Appendix

### A. ClickHouse System Tables Covered

chmonitor queries 40+ ClickHouse system tables including:

`system.query_log`, `system.processes`, `system.merges`, `system.replicas`, `system.parts`, `system.columns`, `system.databases`, `system.tables`, `system.clusters`, `system.settings`, `system.users`, `system.roles`, `system.metrics`, `system.asynchronous_metrics`, `system.events`, `system.disks`, `system.part_log`, `system.mutations`, `system.moves`, `system.replication_queue`, `system.distributed_ddl_queue`, `system.zookeeper` (keeper), `system.backup_log`, `system.error_log`, `system.text_log`, `system.crash_log`, `system.stack_trace`, `system.dictionaries`, `system.kafka_consumers`, `system.projections`, `system.data_skipping_indices`, `system.detached_parts`, `system.dropped_tables`, `system.query_cache`, `system.query_metric_log`, `system.query_views_log`, `system.filesystem_cache`, `system.session_log`, `system.user_directories`, `system.grants`, `system.settings_profile_elements`

### B. AI Agent Tool Inventory

| Category | Tools | Key Functions |
|----------|-------|---------------|
| anomaly-tools | detect_anomalies, get_anomaly_baselines | Statistical anomaly detection |
| capacity-tools | get_capacity_status, predict_capacity | Disk/memory projections |
| cluster-tools | get_cluster_info, get_topology | Cluster structure and health |
| comparison-tools | compare_clusters, compare_periods | Before/after analysis |
| context-tools | get_recent_context, get_system_overview | Environmental awareness |
| control-tools | kill_query, cancel_mutation | Action execution |
| dashboard-tools | create_dashboard, update_widget | Dynamic dashboard management |
| diagnostics-tools | run_diagnostics, check_health | System health checks |
| finding-tools | record_finding, list_findings | Persistent issue tracking |
| health-tools | get_health_status, run_health_check | Health monitoring |
| incident-tools | create_incident, update_incident | Incident lifecycle |
| insights-tools | generate_insights, explain_anomaly | AI-powered explanations |
| log-tools | search_logs, tail_text_log | Log analysis |
| merge-tools | get_merge_status, analyze_merge_perf | Merge operation monitoring |
| migration-tools | plan_migration, validate_migration | Version upgrade assistance |
| optimizer-tools | optimize_query, suggest_indexes | Query optimization |
| plan-tools | create_action_plan, track_progress | Remediation planning |
| query-tools | search_queries, analyze_query | Query analysis |
| replication-tools | get_replication_status, check_replica_lag | Replication monitoring |
| report-tools | generate_report, schedule_report | Automated reporting |
| schema-tools | get_schema, compare_schemas | Schema exploration |
| security-tools | audit_security, check_permissions | Security analysis |
| settings-tools | get_settings, suggest_config | Configuration management |
| skill-tools | load_skill, list_skills | Dynamic capability loading |
| sql-analysis | analyze_sql, explain_plan | SQL deep analysis |
| storage-tools | analyze_storage, suggest_compression | Storage optimization |
| visualization-tools | create_chart, render_topology | Data visualization |
| workflow-tools | define_workflow, execute_workflow | Automation |
| zookeeper-tools | get_keeper_status, browse_znodes | Keeper management |

### C. Deployment Options

| Method | Command | Target |
|--------|---------|--------|
| Cloudflare Workers | `pnpm run cf:deploy` | Edge (primary) |
| Docker | `docker compose up -d` | Self-hosted |
| Kubernetes | Helm chart at `deploy/helm/` | Self-hosted / on-prem |
| Node.js | `pnpm run build:node && pnpm run start:node` | Any server |
| Vercel | `vercel deploy` | Serverless |

### D. Environment Variables Reference

See `apps/dashboard/.env.example` for the complete list. Key categories:

- `CLICKHOUSE_*` — ClickHouse connection (required)
- `VITE_AUTH_PROVIDER` / `CHM_AUTH_PROVIDER` — Auth mode
- `CLERK_*` — Clerk auth (optional)
- `LLM_*` / `OPENROUTER_*` / `ANYROUTER_*` — AI agent provider
- `CHM_API_KEY_SECRET` — API key auth
- `HEALTH_ALERT_*` — Alert configuration
- `CRON_SECRET` — Cron endpoint protection

---

*Document generated: 2026-06-12*  
*Last updated: 2026-06-12*  
*Next review: TBD*
