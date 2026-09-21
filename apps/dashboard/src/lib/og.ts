/**
 * Open Graph page registry — the single source of truth for per-page social
 * cards. Both consumers read from here:
 *
 *   1. scripts/generate-og-images.ts  → renders one og-<slug>.png per entry
 *      (Satori + resvg, regenerated on every Cloudflare deploy).
 *   2. pageOgHead(slug)               → builds the route `head` meta so the
 *      crawler picks up og:image / twitter:image for that page.
 *
 * To add a page card: add an entry here, then `head: () => pageOgHead('<slug>')`
 * in the route. The PNG is produced by `bun run og:generate`.
 *
 * Keep this file free of React / `@/` alias imports — the standalone generator
 * script imports it directly under bun.
 */

export const OG_DOMAIN = 'https://dash.chmonitor.dev'

export type OgPage = {
  /** Small all-caps label above the title in the card. */
  eyebrow: string
  /** Big headline rendered in the image. */
  title: string
  /** One-line supporting copy under the title. */
  description: string
  /**
   * Document/`og:title` text when it should differ from the image headline
   * (e.g. the agents card headline is marketing-y, the tab title is plain).
   * Defaults to `title`.
   */
  headTitle?: string
}

export const OG_PAGES: Record<string, OgPage> = {
  // ── Already shipped in #1614 — kept here so the registry is the only source.
  overview: {
    eyebrow: 'OVERVIEW',
    title: 'Cluster Overview',
    description:
      'Connections, queries, merges, replication and system metrics at a glance.',
  },
  clusters: {
    eyebrow: 'CLUSTERS',
    title: 'Cluster Topology & Health',
    description:
      'Visualize nodes, shards and replicas with live health across your ClickHouse cluster.',
  },
  explorer: {
    eyebrow: 'EXPLORER',
    title: 'Database Explorer',
    description:
      'Browse databases, tables, columns, dependencies and projections in one tree.',
  },
  agents: {
    eyebrow: 'AI AGENT',
    title: 'Ask your cluster anything',
    headTitle: 'AI Agent',
    description:
      'An AI agent that answers questions about queries, schema, performance and health.',
  },

  'report-settings': {
    eyebrow: 'REPORTS',
    title: 'Scheduled Reports',
    headTitle: 'Report Settings',
    description:
      'Weekly or monthly cluster health reports, delivered to your configured alert channels.',
  },

  // ── New monitoring pages (audit wave): registered so pageOgHead() does not
  //    throw "Cannot read properties of undefined (reading 'headTitle')" at prerender.
  'blob-storage-log': {
    eyebrow: 'STORAGE',
    title: 'Object Storage Operations',
    description:
      'Uploads, deletes and errors against S3/GCS/Azure object storage from system.blob_storage_log.',
  },
  'storage-economics': {
    eyebrow: 'STORAGE',
    title: 'Storage Economics',
    description:
      'Compression ratios, tier utilization and TTL moves to track storage cost and efficiency.',
  },
  'ttl-partition-health': {
    eyebrow: 'STORAGE',
    title: 'TTL & Partition Health',
    description:
      'Inventory of table TTL, PARTITION BY, and partition counts — without applying ALTER TTL.',
  },
  'query-condition-cache': {
    eyebrow: 'CACHE',
    title: 'Query Condition Cache',
    description:
      'Usage of the query condition cache (ClickHouse 25.3+) that skips granules for filtered scans.',
  },

  // ── New: key query / monitoring pages.
  'running-queries': {
    eyebrow: 'QUERIES',
    title: 'Running Queries',
    description:
      'Live in-flight queries with progress, memory and elapsed time.',
  },
  'history-queries': {
    eyebrow: 'HISTORY',
    title: 'Query History',
    description:
      'Search and analyze past queries from system.query_log over time.',
  },
  'failed-queries': {
    eyebrow: 'FAILURES',
    title: 'Failed Queries',
    description: 'Queries that errored, with exception messages and context.',
  },
  'slow-queries': {
    eyebrow: 'PERFORMANCE',
    title: 'Slow Queries',
    description: 'The longest-running queries ranked by elapsed time.',
  },
  'expensive-queries': {
    eyebrow: 'COST',
    title: 'Expensive Queries',
    description: 'Queries ranked by memory and resource consumption.',
  },
  traffic: {
    eyebrow: 'TRAFFIC',
    title: 'Cluster Traffic',
    description:
      'Rows, bytes and insert queries flowing into the cluster over time.',
  },
  merges: {
    eyebrow: 'MERGES',
    title: 'Merge Operations',
    description: 'Active and historical part merges across your tables.',
  },
  mutations: {
    eyebrow: 'MUTATIONS',
    title: 'Mutations',
    description: 'ALTER, DELETE and UPDATE mutations and their progress.',
  },
  tables: {
    eyebrow: 'TABLES',
    title: 'Tables',
    description: 'Sizes, parts, rows and engines across your databases.',
  },
  replicas: {
    eyebrow: 'REPLICATION',
    title: 'Replica Status',
    description: 'Replication health, lag and queue depth across replicas.',
  },
  settings: {
    eyebrow: 'SETTINGS',
    title: 'Server Settings',
    description: 'Current server and MergeTree settings for the cluster.',
  },
  'settings-diff': {
    eyebrow: 'SETTINGS',
    title: 'Cross-Host Settings Diff',
    description:
      'Compare system.settings and merge_tree_settings across saved hosts or cluster nodes.',
  },
  'schema-diff': {
    eyebrow: 'SCHEMA',
    title: 'Cross-Host Schema Compare',
    description:
      'Compare table schemas across hosts or cluster nodes and copy a recommend-only change plan.',
  },
  users: {
    eyebrow: 'ACCESS',
    title: 'Users & Roles',
    description: 'Users, roles and grants configured on the cluster.',
  },
  'query-cache': {
    eyebrow: 'CACHE',
    title: 'Query Cache',
    description: 'Query cache usage, entries and hit-rate metrics.',
  },
  backups: {
    eyebrow: 'BACKUPS',
    title: 'Backups',
    description: 'Backup and restore operations from system.backup_log.',
  },
  disks: {
    eyebrow: 'STORAGE',
    title: 'Disks',
    description: 'Disk usage, free space and storage policies.',
  },
  'asynchronous-inserts': {
    eyebrow: 'INGESTION',
    title: 'Async Insert Monitor',
    description:
      'Live async-insert queue and flush history: bytes, rows, latency, and errors per table.',
  },
  'background-schedule-pool': {
    eyebrow: 'SYSTEM',
    title: 'Background Schedule Pool',
    description:
      'Active and upcoming background scheduled tasks with durations and failure history.',
  },
  'histogram-metrics': {
    eyebrow: 'DIAGNOSTICS',
    title: 'Histogram Metrics',
    description:
      'Latency distribution panels for Keeper stages and query durations from system.histogram_metrics (CH 25.1+).',
  },
  'workload-scheduling': {
    eyebrow: 'SCHEDULING',
    title: 'Workload & Resource Scheduling',
    description:
      'SQL resource scheduling workload hierarchy and live scheduler state: weights, priorities, and concurrency caps.',
  },
  'opentelemetry-spans': {
    eyebrow: 'TRACING',
    title: 'OpenTelemetry Span Viewer',
    description:
      'Distributed query trace waterfall from system.opentelemetry_span_log: spans grouped by trace_id across replicas.',
  },
  'index-analytics': {
    eyebrow: 'PERFORMANCE',
    title: 'Index & Projection Analytics',
    description:
      'Data-skipping index and projection inventory with storage cost — flag dead indexes and empty projections.',
  },
  fleet: {
    eyebrow: 'FLEET',
    title: 'Fleet Overview',
    description: 'Health signals across all ClickHouse hosts in one view.',
  },

  // ── Uniform coverage: every remaining page route gets a card so
  //    `head: () => pageOgHead('<slug>')` is wired on all of them.
  //    Slug = route path minus the leading slash (same lookup page-title.ts
  //    uses), so nested groups keep their path: 'keeper/overview' etc.
  about: {
    eyebrow: 'ABOUT',
    title: 'About chmonitor',
    description: 'Version, capabilities and links for this deployment.',
  },
  advisor: {
    eyebrow: 'AI AGENT',
    title: 'Query Advisor',
    description:
      'Index, projection, partition-key and PREWHERE recommendations for a query.',
  },
  'agents/settings': {
    eyebrow: 'AI AGENT',
    title: 'Agent Settings',
    description: 'Configure the AI agent: provider, model and behaviour.',
  },
  'alert-settings': {
    eyebrow: 'ALERTS',
    title: 'Alert Settings',
    description:
      'Where alerts go, when they fire, and what has fired recently.',
  },
  'asynchronous-metrics': {
    eyebrow: 'METRICS',
    title: 'Asynchronous Metrics',
    description:
      'Periodically sampled background metrics from system.asynchronous_metrics.',
  },
  charts: {
    eyebrow: 'CHARTS',
    title: 'Charts',
    description: 'Browse built-in charts for ClickHouse metrics.',
  },
  'clusters/replicas-status': {
    eyebrow: 'REPLICATION',
    title: 'Cluster Replica Status',
    description: 'Replica health and lag for a selected cluster.',
  },
  'common-errors': {
    eyebrow: 'FAILURES',
    title: 'Common Errors',
    description:
      'Error codes, occurrence counts and last-seen messages from system.errors.',
  },
  dashboard: {
    eyebrow: 'CHARTS',
    title: 'Chart Builder',
    description: 'Compose custom dashboards from charts and widgets.',
  },
  'detached-parts': {
    eyebrow: 'PARTS',
    title: 'Detached Parts',
    description: 'Detached MergeTree parts and the reason each was detached.',
  },
  dictionaries: {
    eyebrow: 'TABLES',
    title: 'Dictionaries',
    description: 'External dictionaries loaded in ClickHouse.',
  },
  'distributed-ddl-queue': {
    eyebrow: 'DDL',
    title: 'Distributed DDL Queue',
    description: 'ON CLUSTER DDL tasks executed across the cluster.',
  },
  'dropped-tables': {
    eyebrow: 'TABLES',
    title: 'Dropped Tables',
    description: 'Tables awaiting final asynchronous drop.',
  },
  errors: {
    eyebrow: 'LOGS',
    title: 'Errors',
    description: 'System error codes, counts and history from system.errors.',
  },
  'expensive-queries-by-memory': {
    eyebrow: 'COST',
    title: 'Expensive Queries (Memory)',
    description:
      'Most expensive queries by memory over the selected time window.',
  },
  explain: {
    eyebrow: 'TOOLS',
    title: 'Explain',
    description:
      'Inspect EXPLAIN plans, applied optimizations and projection analysis.',
  },
  health: {
    eyebrow: 'HEALTH',
    title: 'Health Summary',
    description: 'Real-time health indicators for your ClickHouse cluster.',
  },
  'health-settings': {
    eyebrow: 'HEALTH',
    title: 'Health Settings',
    description:
      'Per-check warning and critical thresholds plus alert delivery.',
  },
  'inbound-events': {
    eyebrow: 'EVENTS',
    title: 'Inbound Events',
    description:
      'Normalized inbound events ingested via the event bus (Alertmanager, Datadog, webhooks).',
  },
  insights: {
    eyebrow: 'INSIGHTS',
    title: 'Insights',
    description:
      'Query, traffic and activity analytics with AI-generated findings.',
  },
  'insights-settings': {
    eyebrow: 'INSIGHTS',
    title: 'Insights Settings',
    description: 'Configure AI insight generation and stats thresholds.',
  },
  'kafka-consumers': {
    eyebrow: 'INGESTION',
    title: 'Kafka Consumers',
    description:
      'Kafka engine consumer state: poll/commit activity and last exception.',
  },
  keeper: {
    eyebrow: 'KEEPER',
    title: 'Keeper Data Browser',
    description: 'Browse the ClickHouse Keeper / ZooKeeper znode tree.',
  },
  'keeper/overview': {
    eyebrow: 'KEEPER',
    title: 'Keeper Overview',
    description:
      'Keeper/ZooKeeper health: liveness, request load, latency and node state.',
  },
  'keeper/connections': {
    eyebrow: 'KEEPER',
    title: 'Keeper Connections',
    description: 'Live Keeper client connections and session state.',
  },
  'keeper/watches': {
    eyebrow: 'KEEPER',
    title: 'Keeper Watches',
    description: 'Active Keeper watches by path and session.',
  },
  'keeper/connection-log': {
    eyebrow: 'KEEPER',
    title: 'Keeper Connection Log',
    description: 'Connection and disconnection events with reason codes.',
  },
  'keeper/info': {
    eyebrow: 'KEEPER',
    title: 'Keeper Info',
    description:
      'Per-node Keeper introspection: role, latency, raft indices and data size.',
  },
  'keeper/log': {
    eyebrow: 'KEEPER',
    title: 'Keeper Request Log',
    description: 'Per-request log of operations sent to Keeper and responses.',
  },
  'keeper/deep-dive': {
    eyebrow: 'KEEPER',
    title: 'Keeper Deep Dive',
    description:
      'Raft membership, snapshots and changelogs for the Keeper ensemble.',
  },
  'logs/crashes': {
    eyebrow: 'LOGS',
    title: 'Crash Log',
    description: 'Server crash history and details from system.crash_log.',
  },
  'logs/stack-traces': {
    eyebrow: 'LOGS',
    title: 'Stack Traces',
    description: 'Current stack traces for all server threads.',
  },
  'logs/text-log': {
    eyebrow: 'LOGS',
    title: 'Server Text Log',
    description: 'Server log messages from system.text_log.',
  },
  mcp: {
    eyebrow: 'MCP',
    title: 'MCP Server',
    description:
      'MCP endpoint, setup guides and tool reference for AI clients.',
  },
  'merge-performance': {
    eyebrow: 'MERGES',
    title: 'Merge Performance',
    description: 'Merge duration and rows read over time.',
  },
  'mergetree-settings': {
    eyebrow: 'SETTINGS',
    title: 'MergeTree Settings',
    description: 'MergeTree engine settings from system.merge_tree_settings.',
  },
  metrics: {
    eyebrow: 'METRICS',
    title: 'Metrics',
    description: 'Instant server metrics from system.metrics.',
  },
  moves: {
    eyebrow: 'PARTS',
    title: 'Part Moves',
    description: 'In-progress part moves between disks and volumes.',
  },
  'page-views': {
    eyebrow: 'ANALYTICS',
    title: 'Page Views',
    description: 'Usage analytics for the chmonitor dashboard.',
  },
  'part-info': {
    eyebrow: 'PARTS',
    title: 'Part Info',
    description: 'Active parts and levels for a selected table.',
  },
  'part-log': {
    eyebrow: 'PARTS',
    title: 'Part Log',
    description:
      'Part lifecycle events — merges, mutations, moves — from system.part_log.',
  },
  'postgres/activity': {
    eyebrow: 'POSTGRES',
    title: 'Postgres Activity',
    description: 'Live client backends from pg_stat_activity.',
  },
  'postgres/queries': {
    eyebrow: 'POSTGRES',
    title: 'Postgres Query Insights',
    description: 'Slow query patterns from pg_stat_statements.',
  },
  profiler: {
    eyebrow: 'DIAGNOSTICS',
    title: 'Query Profiler',
    description: 'Query processor profiling data.',
  },
  projections: {
    eyebrow: 'TABLES',
    title: 'Projections',
    description: 'Projection definitions and storage cost per table.',
  },
  'queries/insights': {
    eyebrow: 'QUERIES',
    title: 'Query Insights',
    description:
      'Query performance dashboards: latency, memory, cache hit ratio, errors and hot tables.',
  },
  'queries/parallelization': {
    eyebrow: 'PERFORMANCE',
    title: 'Query Parallelization',
    description: 'Thread-level parallelization of query execution.',
  },
  'queries/thread-analysis': {
    eyebrow: 'PERFORMANCE',
    title: 'Thread Analysis',
    description: 'Per-thread query execution breakdown.',
  },
  query: {
    eyebrow: 'QUERIES',
    title: 'Query Details',
    description:
      'Stages, settings, profile events and resource usage for a single query.',
  },
  'query-metric-log': {
    eyebrow: 'DIAGNOSTICS',
    title: 'Query Metric Log',
    description: 'Per-query resource usage sampled over each query lifetime.',
  },
  'query-views-log': {
    eyebrow: 'DIAGNOSTICS',
    title: 'Query Views Log',
    description: 'Materialized view execution log: targets, durations, rows.',
  },
  'rabbitmq-consumers': {
    eyebrow: 'INGESTION',
    title: 'RabbitMQ Consumers',
    description:
      'RabbitMQ engine consumer state: active consumers, messages and errors.',
  },
  'readonly-tables': {
    eyebrow: 'TABLES',
    title: 'Readonly Tables',
    description: 'Tables currently in read-only state.',
  },
  'recent-queries': {
    eyebrow: 'HISTORY',
    title: 'Recent Queries',
    description: 'The most recently finished queries from system.query_log.',
  },
  'replicated-fetches': {
    eyebrow: 'REPLICATION',
    title: 'Replicated Fetches',
    description: 'Currently executing background part downloads from replicas.',
  },
  'replicated-merge-tree-settings': {
    eyebrow: 'REPLICATION',
    title: 'Replicated MergeTree Settings',
    description: 'Replicated MergeTree settings and changes from default.',
  },
  'replication-queue': {
    eyebrow: 'REPLICATION',
    title: 'Replication Queue',
    description: 'Replication queue tasks stored in Keeper / ZooKeeper.',
  },
  roles: {
    eyebrow: 'ACCESS',
    title: 'Roles',
    description: 'Roles and grants configured on the cluster.',
  },
  'security/audit-log': {
    eyebrow: 'ACCESS',
    title: 'Audit Log',
    description: 'Audit trail of user and admin actions.',
  },
  'security/login-attempts': {
    eyebrow: 'ACCESS',
    title: 'Login Attempts',
    description: 'Login success and failure tracking.',
  },
  'security/management': {
    eyebrow: 'ACCESS',
    title: 'RBAC Management',
    description: 'Manage users, roles and grants with guarded writes.',
  },
  'security/sessions': {
    eyebrow: 'ACCESS',
    title: 'User Sessions',
    description: 'Active and historical user sessions.',
  },
  setup: {
    eyebrow: 'SETUP',
    title: 'Setup',
    description: 'Connect your first ClickHouse host to start monitoring.',
  },
  'slow-query-patterns': {
    eyebrow: 'PERFORMANCE',
    title: 'Slow Query Patterns',
    description:
      'Query patterns grouped by normalized hash: calls, percentiles, resource usage.',
  },
  sql: {
    eyebrow: 'TOOLS',
    title: 'SQL Console',
    description: 'Run ad-hoc SQL against your ClickHouse cluster.',
  },
  'tables-overview': {
    eyebrow: 'TABLES',
    title: 'Tables Overview',
    description: 'Table counts, sizes and rows summarized per database.',
  },
  'top-cpu-queries': {
    eyebrow: 'PERFORMANCE',
    title: 'Top CPU Queries',
    description: 'Running and finished queries ranked by total CPU time.',
  },
  'top-memory-queries': {
    eyebrow: 'PERFORMANCE',
    title: 'Top Memory Queries',
    description: 'Running and finished queries ranked by peak memory usage.',
  },
  'top-usage-columns': {
    eyebrow: 'USAGE',
    title: 'Top Usage Columns',
    description: 'Most-used columns across tables from system.query_log.',
  },
  'top-usage-tables': {
    eyebrow: 'USAGE',
    title: 'Top Usage Tables',
    description: 'Most-queried tables from system.query_log.',
  },
  'user-processes': {
    eyebrow: 'SYSTEM',
    title: 'User Processes',
    description: 'Per-user live queries and historical activity.',
  },
  'view-refreshes': {
    eyebrow: 'TABLES',
    title: 'View Refreshes',
    description:
      'Materialized view refresh operations from system.view_refreshes.',
  },
  warnings: {
    eyebrow: 'SYSTEM',
    title: 'Warnings',
    description:
      'Server-side warnings about configuration or operational issues.',
  },
}

/** Absolute URL of a page's OG image, e.g. .../og-running-queries.png. */
export function ogImageUrl(slug: string): string {
  return `${OG_DOMAIN}/og/og-${slug}.png`
}

/**
 * TanStack Router `head` payload for a dashboard page. Returns the title plus
 * og:/twitter: image meta; the shared og:type, dimensions and twitter:card
 * defaults come from __root.tsx.
 */
export function pageOgHead(slug: keyof typeof OG_PAGES) {
  const page = OG_PAGES[slug]
  const fullTitle = `${page.headTitle ?? page.title} — chmonitor`
  const image = ogImageUrl(slug)
  return {
    meta: [
      { title: fullTitle },
      { property: 'og:title', content: fullTitle },
      { property: 'og:image', content: image },
      { name: 'twitter:image', content: image },
    ],
  }
}
