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
      'Compare system.settings and merge_tree_settings across all configured ClickHouse hosts.',
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
