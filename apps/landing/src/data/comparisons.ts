/**
 * Row data for the /vs-* comparison pages (`ComparisonTable.astro`).
 *
 * Every chmonitor cell maps to a shipped capability — verified against
 * `apps/dashboard` source, not the pricing page's advertised entitlements
 * (those are billing tiers, not a "what exists" test). Every competitor cell
 * is sourced from that competitor's public docs/pricing pages as of July 2026
 * (see each page's `note` slot for links) and is deliberately not a strawman:
 * each table includes rows where the competitor legitimately wins.
 */

import type { ComparisonRow } from '../components/ComparisonTable.astro'

export const grafanaRows: ComparisonRow[] = [
  {
    label: 'Setup time',
    chm: {
      kind: 'plain',
      text: 'Point at your ClickHouse host — Docker, Helm, or Cloudflare Workers, ~5 min',
    },
    them: {
      kind: 'plain',
      text: 'Install Grafana, add the ClickHouse data source (Altinity or official plugin), then build panels',
    },
  },
  {
    label: 'Pre-built ClickHouse monitoring',
    chm: {
      kind: 'yes',
      text: 'Queries, merges, parts, replication and health ship as complete pages — no query-writing',
    },
    them: {
      kind: 'partial',
      text: 'The plugin gives you a SQL editor and macros; you write or import the panel queries yourself',
    },
  },
  {
    label: 'Visualization flexibility & multi-datasource dashboards',
    chm: {
      kind: 'no',
      text: 'Single-purpose: ClickHouse only, fixed page layouts',
    },
    them: {
      kind: 'yes',
      text: 'Best-in-class panel library and one pane of glass across dozens of data sources',
    },
  },
  {
    label: 'Plugin & panel ecosystem',
    chm: { kind: 'no', text: 'No plugin marketplace' },
    them: {
      kind: 'yes',
      text: 'A decade-deep plugin catalog for panels, data sources and alerting',
    },
  },
  {
    label: 'AI agent + MCP server for your cluster',
    chm: {
      kind: 'yes',
      text: 'Built-in chat agent and an MCP server with ClickHouse-aware tools (query log, merges, replication)',
    },
    them: {
      kind: 'no',
      text: 'No built-in agent or MCP server scoped to ClickHouse system tables',
    },
  },
  {
    label: 'Query advisor (recommend-only)',
    chm: {
      kind: 'yes',
      text: 'Ranked index/rewrite suggestions with EXPLAIN-based impact estimates; never auto-applies DDL',
    },
    them: {
      kind: 'no',
      text: 'No query advisor — you write and tune SQL yourself',
    },
  },
  {
    label: 'Materialized view / projection designer',
    chm: {
      kind: 'yes',
      text: 'Recommend-only MV & projection suggestions derived from real query patterns',
    },
    them: {
      kind: 'no',
      text: 'Not a dashboarding concern — no schema-design tooling',
    },
  },
  {
    label: 'Anomaly detection on cluster metrics',
    chm: {
      kind: 'yes',
      text: 'Statistical baselines per metric, built in',
    },
    them: {
      kind: 'partial',
      text: "Grafana's alerting supports threshold and anomaly-style rules, but you configure and tune each one",
    },
  },
  {
    label: 'Alerting & webhooks',
    chm: {
      kind: 'yes',
      text: 'ClickHouse-native thresholds and outbound webhooks run everywhere; alert history and inbound-event storage persist with a D1 binding (hosted cloud or a Cloudflare Workers self-host)',
    },
    them: {
      kind: 'yes',
      text: 'Mature unified alerting across every connected data source with broad notification routing',
    },
  },
  {
    label: 'Version-aware SQL across ClickHouse releases',
    chm: {
      kind: 'yes',
      text: 'The query set adapts automatically to the connected ClickHouse version',
    },
    them: {
      kind: 'no',
      text: 'Panel queries are static SQL you maintain yourself across upgrades',
    },
  },
  {
    label: 'Cost',
    chm: {
      kind: 'plain',
      text: 'Free self-hosted (GPL-3.0); hosted cloud in early access',
    },
    them: {
      kind: 'plain',
      text: 'Grafana OSS free; Grafana Cloud from $19/mo + usage (~$6.50 per 1K active series, ~$0.45/GB logs/traces), Enterprise from $25K/yr (2026 list pricing)',
    },
  },
  {
    label: 'Open source / self-host',
    chm: {
      kind: 'yes',
      text: 'GPL-3.0 — Docker, Kubernetes (Helm), Cloudflare Workers',
    },
    them: { kind: 'yes', text: 'Grafana OSS is AGPL-3.0 and self-hostable' },
  },
]

export const datadogRows: ComparisonRow[] = [
  {
    label: 'Setup time',
    chm: {
      kind: 'plain',
      text: 'Point at your ClickHouse host — Docker, Helm, or Cloudflare Workers, ~5 min',
    },
    them: {
      kind: 'plain',
      text: 'Install the Datadog Agent and ClickHouse integration check on every node',
    },
  },
  {
    label: 'Agents required',
    chm: {
      kind: 'yes',
      text: 'None — reads system tables directly over the ClickHouse protocol',
    },
    them: {
      kind: 'no',
      text: 'A Datadog Agent process runs on every monitored host',
    },
  },
  {
    label: 'ClickHouse-specific depth',
    chm: {
      kind: 'yes',
      text: 'Purpose-built pages for query log, merges, parts, replication queue and Keeper quorum',
    },
    them: {
      kind: 'partial',
      text: 'A fixed ClickHouse integration metric set; no dedicated merge/part/replication drill-down UI',
    },
  },
  {
    label: 'Full-stack APM, distributed tracing & log management',
    chm: { kind: 'no', text: 'ClickHouse monitoring only, by design' },
    them: {
      kind: 'yes',
      text: 'Industry-leading APM, tracing and log management across your entire stack',
    },
  },
  {
    label: 'On-call, escalation & incident management',
    chm: { kind: 'no', text: 'No on-call/escalation product' },
    them: {
      kind: 'yes',
      text: 'Mature on-call routing, escalation policies and incident management',
    },
  },
  {
    label: 'AI agent for ClickHouse system tables',
    chm: {
      kind: 'yes',
      text: "Chat agent + MCP server with tools scoped to ClickHouse's own system tables",
    },
    them: {
      kind: 'partial',
      text: "Datadog's AI features reason over Datadog telemetry, not ClickHouse system-table semantics specifically",
    },
  },
  {
    label: 'Query advisor (recommend-only)',
    chm: {
      kind: 'yes',
      text: 'Ranked index/rewrite suggestions with EXPLAIN-based impact estimates; never auto-applies DDL',
    },
    them: {
      kind: 'no',
      text: 'Not part of a general infra-monitoring integration',
    },
  },
  {
    label: 'Materialized view / projection designer',
    chm: {
      kind: 'yes',
      text: 'Recommend-only MV & projection suggestions derived from real query patterns',
    },
    them: { kind: 'no', text: 'Out of scope for the integration' },
  },
  {
    label: 'Anomaly detection',
    chm: {
      kind: 'yes',
      text: 'Statistical baselines scoped to ClickHouse cluster metrics, built in',
    },
    them: {
      kind: 'yes',
      text: 'Mature, general-purpose anomaly and forecast monitors across any metric you send it',
    },
  },
  {
    label: 'Alerting & webhooks',
    chm: {
      kind: 'yes',
      text: 'ClickHouse-specific thresholds and outbound webhooks run everywhere — narrower by design; alert history and inbound-event storage persist with a D1 binding (hosted cloud or a Cloudflare Workers self-host)',
    },
    them: {
      kind: 'yes',
      text: 'Broad monitor types, deep notification integrations and escalation across your whole stack',
    },
  },
  {
    label: 'Cost',
    chm: {
      kind: 'plain',
      text: 'Free self-hosted (GPL-3.0); hosted cloud in early access',
    },
    them: {
      kind: 'plain',
      text: 'Infrastructure Monitoring ~$15–$23/host/month; APM adds ~$31/host/month; logs billed per GB (2026 list pricing, varies by commitment)',
    },
  },
  {
    label: 'Open source / self-host',
    chm: {
      kind: 'yes',
      text: 'GPL-3.0 — Docker, Kubernetes (Helm), Cloudflare Workers',
    },
    them: { kind: 'no', text: 'SaaS only, no self-hosted option' },
  },
]

export const clickhouseCloudRows: ComparisonRow[] = [
  {
    label: 'What it is',
    chm: {
      kind: 'plain',
      text: 'An independent monitoring/ops layer you run alongside any ClickHouse deployment',
    },
    them: {
      kind: 'plain',
      text: "ClickHouse Inc's fully managed ClickHouse hosting service",
    },
  },
  {
    label: 'Fully managed hosting (no servers to run)',
    chm: {
      kind: 'no',
      text: "Not a hosting product — it's an ops layer on top of whatever ClickHouse you run",
    },
    them: {
      kind: 'yes',
      text: 'Zero-ops managed service: autoscaling, backups and upgrades handled for you',
    },
  },
  {
    label: 'Works with self-managed / on-prem / any-cloud ClickHouse',
    chm: {
      kind: 'yes',
      text: 'Any ClickHouse — OSS, Altinity, ClickHouse Cloud — on your infra or any cloud',
    },
    them: {
      kind: 'no',
      text: 'Monitors the ClickHouse Cloud service itself, not clusters you self-manage',
    },
  },
  {
    label: 'ClickHouse-specific ops depth',
    chm: {
      kind: 'yes',
      text: 'Dedicated pages for the full merge/part/replication-queue/Keeper lifecycle',
    },
    them: {
      kind: 'partial',
      text: 'The Cloud console shows service-level metrics and Query Insights, with less part/merge/replication drill-down than a dedicated ops tool',
    },
  },
  {
    label: 'AI agent / natural-language assistant',
    chm: {
      kind: 'yes',
      text: 'Built-in agent + MCP server, works against any connected ClickHouse — analytics and cluster ops',
    },
    them: {
      kind: 'yes',
      text: "Ask AI agent (public beta, March 2026) — natural-language analysis over your Cloud service's data; analytics-first, not a cluster-ops advisor",
    },
  },
  {
    label: 'MCP server for AI tools',
    chm: {
      kind: 'yes',
      text: 'Ships with every deployment, self-hosted included',
    },
    them: {
      kind: 'partial',
      text: 'Remote MCP server in public beta (March 2026), Cloud-only, OAuth-gated, read-only SELECT scope',
    },
  },
  {
    label: 'Query advisor (recommend-only)',
    chm: {
      kind: 'yes',
      text: 'Ranked index/rewrite suggestions with EXPLAIN-based impact estimates; never auto-applies DDL',
    },
    them: {
      kind: 'no',
      text: "Ask AI can write and run queries, but isn't a schema-optimization advisor",
    },
  },
  {
    label: 'Materialized view / projection designer',
    chm: {
      kind: 'yes',
      text: 'Recommend-only MV & projection suggestions derived from real query patterns',
    },
    them: { kind: 'no', text: 'No dedicated MV/projection design tool' },
  },
  {
    label: 'Anomaly detection on cluster health',
    chm: {
      kind: 'yes',
      text: 'Statistical baselines on cluster/query metrics, built in',
    },
    them: {
      kind: 'partial',
      text: 'Console surfaces usage and service metrics; no dedicated statistical-baseline alerting product',
    },
  },
  {
    label: 'Alerting & webhooks',
    chm: {
      kind: 'yes',
      text: 'Cluster-health thresholds and outbound webhooks run everywhere; alert history and inbound-event storage persist with a D1 binding (hosted cloud or a Cloudflare Workers self-host)',
    },
    them: {
      kind: 'partial',
      text: 'Billing/usage and service notifications; not general cluster-health threshold alerting with webhook delivery',
    },
  },
  {
    label: 'Pricing model',
    chm: {
      kind: 'plain',
      text: 'Free self-hosted (GPL-3.0); hosted cloud in early access',
    },
    them: {
      kind: 'plain',
      text: 'Usage-based: ~$0.22–$0.39 per compute-unit-hour plus ~$25/TB-month storage; no permanent free tier (30-day / $300-credit trial)',
    },
  },
  {
    label: 'Open source',
    chm: { kind: 'yes', text: 'GPL-3.0, full source available' },
    them: {
      kind: 'no',
      text: 'Proprietary managed service (built on the open-source ClickHouse core)',
    },
  },
]
