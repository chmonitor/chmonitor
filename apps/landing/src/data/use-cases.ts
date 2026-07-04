/**
 * Use-case landing page content — the single source of truth for the four
 * SEO landing pages (see plans/64-seo-use-case-landing-pages.md).
 *
 * Every claim here must map to a real, shipped chmonitor capability: this
 * file IS the honesty-audit surface for those pages. `use-cases.test.ts`
 * enforces the shape (unique slug/title/h1/description) and a denylist of
 * roadmap-only feature names (PagerDuty, Telegram, OpsGenie, email alerts,
 * DDL auto-apply) that are not wired to any UI today — see the alerting
 * adapters audit trail in that file's comments.
 */

export interface UseCaseBenefit {
  /** Inner SVG markup (paths/shapes only), viewBox 0 0 24 24, stroke style. */
  icon: string
  title: string
  body: string
}

export interface UseCase {
  /** Route slug — the page lives at /<slug>. */
  slug: string
  /** <title> tag — must stay unique across all use cases + existing pages. */
  title: string
  /** <meta description> — must stay unique across all use cases. */
  description: string
  /** Short label — page eyebrow, footer link, breadcrumb schema name. */
  eyebrow: string
  /** Page <h1> — must stay unique across all use cases. */
  h1: string
  /** One-line summary for compact cross-link cards (footer/homepage/related). */
  cardBlurb: string
  subhead: string
  heroImage: string
  heroImageAlt: string
  /** Actual intrinsic pixel size of `heroImage` — reserves layout space (no CLS). */
  heroImageWidth: number
  heroImageHeight: number
  benefits: UseCaseBenefit[]
  /** SoftwareApplication JSON-LD featureList for this page. */
  featureList: string[]
}

const SPARKLE_ICON =
  '<path d="M12 2 13.5 9.5 21 11l-7.5 1.5L12 20l-1.5-7.5L3 11l7.5-1.5z"/>'
const HEALTH_ICON =
  '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'
const TOPOLOGY_ICON =
  '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="9" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9"/><path d="M12 13v2"/>'
const QUERY_GRID_ICON =
  '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
const STOP_ICON = '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8"/>'
const BELL_ICON =
  '<path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 6 2 6.5H4c.5-.5 2-2.5 2-6.5"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/>'
const ACTIVITY_ICON = '<path d="M3 12h4l3-8 4 16 3-8h4"/>'
const QUEUE_ICON =
  '<rect x="4" y="5" width="16" height="4" rx="1"/><rect x="4" y="11" width="16" height="4" rx="1"/><rect x="4" y="17" width="10" height="4" rx="1"/>'
const BARS_ICON =
  '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20v-3"/>'
const CAPACITY_ICON =
  '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'

export const useCases: UseCase[] = [
  {
    slug: 'monitor-queries',
    title:
      'chmonitor Query Monitoring — Live, Slow & Expensive ClickHouse Queries',
    description:
      'Monitor ClickHouse queries in real time: running, slow, failed and most expensive, with duration, memory and rows read. Kill runaway queries and review recommend-only EXPLAIN suggestions.',
    eyebrow: 'Query monitoring',
    h1: 'Monitor ClickHouse queries in real time',
    cardBlurb:
      'Running, slow, failed and expensive queries — with kill and recommend-only EXPLAIN suggestions.',
    subhead:
      "See every running, slow, failed and expensive query as it happens, with duration, memory and rows read, then act: kill a runaway query or review a recommend-only EXPLAIN suggestion for the one that's actually slow.",
    heroImage: '/landing-assets/running-queries-light.png',
    heroImageAlt:
      'chmonitor running queries view with live charts and a detailed table',
    heroImageWidth: 1024,
    heroImageHeight: 719,
    benefits: [
      {
        icon: QUERY_GRID_ICON,
        title: 'Every query, live',
        body: 'Running, history, failed, slowest and most expensive queries, each with duration, memory, rows read and the full statement. Filter by user and slice by time.',
      },
      {
        icon: STOP_ICON,
        title: 'Kill it from the table',
        body: 'Stop a long-running or runaway query directly from the row — no separate SQL client or hand-written KILL QUERY needed.',
      },
      {
        icon: SPARKLE_ICON,
        title: 'Recommend-only EXPLAIN suggestions',
        body: 'Run EXPLAIN and get heuristic suggestions — missing PREWHERE, unpruned partitions, unkeyed joins, missing index hints. chmonitor never rewrites or applies anything; you review and apply the fix.',
      },
    ],
    featureList: [
      'Live running query monitoring',
      'Query history, slow, failed and most-expensive query views',
      'Kill running queries from the table',
      'Recommend-only EXPLAIN tuning suggestions',
    ],
  },
  {
    slug: 'cluster-health',
    title: 'chmonitor Cluster Health — ClickHouse Health Checks & Alerts',
    description:
      'ClickHouse cluster health monitoring: replication lag, failed queries, disk, memory and stuck mutations on one board, with alerts to Slack or Discord when a check crosses your threshold.',
    eyebrow: 'Cluster health',
    h1: 'ClickHouse cluster health monitoring, at a glance',
    cardBlurb:
      'A color-coded health board with Slack/Discord alerts and recovery notifications.',
    subhead:
      'One board of color-coded health checks — replication lag, failed queries, disk, memory, stuck mutations — with alerts to Slack or Discord when something turns red, and again when it recovers.',
    heroImage: '/landing-assets/health-summary.png',
    heroImageAlt: 'chmonitor cluster health summary board',
    heroImageWidth: 1024,
    heroImageHeight: 564,
    benefits: [
      {
        icon: HEALTH_ICON,
        title: 'Every health signal in one board',
        body: 'Green, warn or critical indicators for replication lag, readonly replicas, delayed inserts, failed queries, memory, disk, parts-per-partition and stuck mutations.',
      },
      {
        icon: BELL_ICON,
        title: 'Alerts to Slack or Discord',
        body: 'Configure one webhook URL and chmonitor posts a message when a check crosses your threshold — and again when it recovers, so you know an incident actually cleared.',
      },
      {
        icon: SPARKLE_ICON,
        title: 'A ready audit prompt for your agent',
        body: 'Turn any failing check into a structured prompt — the metric, raw data, relevant system tables and common causes — to paste into an AI agent for a tailored diagnosis.',
      },
    ],
    featureList: [
      'Color-coded cluster health board',
      'Slack/Discord-compatible webhook alerts with recovery notifications',
      'One-click audit prompt for AI agents',
    ],
  },
  {
    slug: 'replication',
    title: 'chmonitor Replication Monitor — ClickHouse Replica Lag & Topology',
    description:
      'Monitor ClickHouse replication lag, read-only replicas and the replication queue across every shard, visualized on a live cluster topology map, with alerts when replication falls behind.',
    eyebrow: 'Replication',
    h1: 'Monitor ClickHouse replication lag and read-only replicas',
    cardBlurb:
      'Replica lag, read-only replicas and replication queues, on a live topology map.',
    subhead:
      'Track replica lag, read-only replicas, the replication queue and distributed DDL across every shard — visualized on a live cluster topology map, with alerts when replication falls behind.',
    heroImage: '/landing-assets/cluster-topology-light.png',
    heroImageAlt:
      'chmonitor cluster topology: ClickHouse nodes, shards, replicas and the Keeper quorum with live replication links',
    heroImageWidth: 1024,
    heroImageHeight: 670,
    benefits: [
      {
        icon: TOPOLOGY_ICON,
        title: 'See the whole topology',
        body: 'Nodes, shards, replicas and the Keeper quorum on one interactive map, with live replication and coordination links.',
      },
      {
        icon: ACTIVITY_ICON,
        title: 'Replication lag and read-only replicas',
        body: 'Health checks flag lag and read-only replicas before they become an outage, with an optional alert to Slack or Discord when a replica falls behind your threshold.',
      },
      {
        icon: QUEUE_ICON,
        title: 'Replication & DDL queues',
        body: 'Inspect the replication queue, replicated fetches and the distributed DDL queue to see exactly what is in flight or stuck on each replica.',
      },
    ],
    featureList: [
      'Cluster topology map with replicas and Keeper quorum',
      'Replication lag and read-only replica health checks',
      'Replication queue, replicated fetches and distributed DDL queue views',
    ],
  },
  {
    slug: 'performance',
    title: 'chmonitor Performance — ClickHouse Query Tuning & Capacity Advisor',
    description:
      'Find the ClickHouse queries actually costing you time and memory, then get recommend-only tuning suggestions from EXPLAIN and a capacity/TTL advisor. Nothing is applied automatically.',
    eyebrow: 'Performance',
    h1: 'ClickHouse performance tuning, backed by real query data',
    cardBlurb:
      'Slowest/most-expensive queries plus a recommend-only tuning and capacity advisor.',
    subhead:
      'Find the queries actually costing you time and memory, then get recommend-only tuning suggestions from EXPLAIN and a capacity/TTL advisor — chmonitor never rewrites schema or executes DDL for you.',
    heroImage: '/landing-assets/g-explain.png',
    heroImageAlt:
      'chmonitor EXPLAIN view with recommend-only tuning suggestions',
    heroImageWidth: 1024,
    heroImageHeight: 613,
    benefits: [
      {
        icon: BARS_ICON,
        title: 'Slowest and most expensive queries',
        body: 'Ranked by duration, memory and rows read, so you know exactly where tuning effort will actually pay off.',
      },
      {
        icon: SPARKLE_ICON,
        title: 'EXPLAIN-based suggestions, recommend-only',
        body: 'Missing PREWHERE, unpruned partitions, unkeyed joins and missing index hints, surfaced as suggestions you review and apply yourself.',
      },
      {
        icon: CAPACITY_ICON,
        title: 'Capacity & TTL advisor',
        body: 'Ask the built-in AI agent to forecast disk-full dates from write growth and suggest a TTL change to stay under budget. It returns a suggested ALTER TABLE ... MODIFY TTL statement — it never runs one.',
      },
    ],
    featureList: [
      'Slowest and most-expensive query views',
      'Recommend-only EXPLAIN tuning suggestions',
      'AI-agent capacity and TTL advisor (suggests, never executes DDL)',
    ],
  },
]
