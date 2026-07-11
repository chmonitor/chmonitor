export type FeatureIconId =
  | 'bot'
  | 'search'
  | 'git-branch'
  | 'bell'
  | 'database'
  | 'line-chart'

export type FeatureSection = {
  id: string
  icon: FeatureIconId
  eyebrow: string
  title: string
  description: string
  bullets: string[]
  screenshot: {
    src: string
    srcDark?: string
    alt: string
  }
  /** Flip screenshot to the left on wide screens */
  reverse?: boolean
  /** Optional "Learn more" link, e.g. to a docs page */
  learnMoreHref?: string
}

export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    id: 'feature-ai-agent',
    icon: 'bot',
    eyebrow: 'AI Agent',
    title: 'Ask your cluster anything',
    description:
      'The built-in agent reads schema and query_log before recommending. Connect over MCP from Claude, Cursor or any client.',
    bullets: [
      '29 tools across schema, diagnostics and optimization',
      'Recommend-only advisor: skip indexes, projections and PREWHERE rewrites',
      'Bring your own model, skills and external MCP servers',
      'Read-only MCP endpoint — nothing applied without you',
    ],
    screenshot: {
      src: '/assets/screenshots/ai-agent-new-dark.webp',
      alt: 'chmonitor AI agent chat with schema-aware recommendations',
    },
  },
  {
    id: 'feature-queries',
    icon: 'search',
    eyebrow: 'Query monitoring',
    title: 'Every query, explained',
    description:
      'Running, history, failed, slowest and most expensive queries — duration, memory, rows read and the full statement.',
    bullets: [
      'Queries by user and top patterns over time',
      'Saved filter presets and one-click EXPLAIN',
      'Kill long-running queries from the table',
      'Query heatmap and record-breaker insights',
    ],
    screenshot: {
      src: '/assets/screenshots/running-queries-new-dark.webp',
      alt: 'Running queries with live charts and sortable table',
    },
    reverse: true,
  },
  {
    id: 'feature-topology',
    icon: 'git-branch',
    eyebrow: 'Cluster topology',
    title: 'See the whole cluster at a glance',
    description:
      'Interactive map of nodes, shards, replicas and Keeper quorum — live replication links, health states and per-node metrics.',
    bullets: [
      'ClickHouse nodes and Keeper quorum with leader and followers',
      'Physical and logical clusters, overlapping virtual clusters',
      'Per-node CPU, memory and latency — healthy, warn or unreachable',
    ],
    screenshot: {
      src: '/assets/screenshots/cluster-topo-viz-with-bg.png',
      alt: 'chmonitor cluster topology map: Keeper quorum with leader and followers, ClickHouse shard nodes, virtual cluster overlays, and an inspector panel with quorum health and znode count',
    },
  },
  {
    id: 'feature-alerting',
    icon: 'bell',
    eyebrow: 'Alerting',
    title: 'Know before your users do',
    description:
      'Built-in health checks watch replication lag, disk, memory and failed queries — each with tunable warning and critical thresholds.',
    bullets: [
      'One webhook URL — Slack, Discord, PagerDuty or Opsgenie',
      'Editable thresholds per check with full fire and recovery history',
      'One-click AI audit prompt for any failing check',
    ],
    screenshot: {
      // Dark-only, like the other five: a themed pair here would make this the
      // one band that flips to a light capture on the light canvas.
      src: '/assets/screenshots/chmonitor-health-dark.png',
      alt: 'Health checks with editable warning and critical thresholds',
    },
    reverse: true,
  },
  {
    id: 'feature-explorer',
    icon: 'database',
    eyebrow: 'Data Explorer',
    title: 'Explore tables and how they connect',
    description:
      'Browse every database and table, map dependencies between them, then drop into SQL — all without leaving the dashboard.',
    bullets: [
      'Dependency graph: materialized views, dictionaries and sources',
      'Run SQL with row counts, timing, DDL and parts inspection',
      'Projections, skip indexes and table lineage at a glance',
    ],
    screenshot: {
      src: '/assets/screenshots/data-explorer-new-dark.webp',
      alt: 'Data explorer dependency graph between tables',
    },
  },
  {
    id: 'feature-insights',
    icon: 'line-chart',
    eyebrow: 'Insights',
    title: "Know your cluster's vitals",
    description:
      'Record-breaking queries, storage stats and a full year of activity — surfaced automatically, no dashboards to build.',
    bullets: [
      'AI-generated findings with stable-key dismissal',
      'Query activity heatmap — a year of volume at a glance',
      'Storage breakdown by database, table and part',
      'SQL console with history, EXPLAIN and scan analysis',
    ],
    screenshot: {
      src: '/assets/screenshots/cluster-insights-dark-with-bg.jpeg',
      alt: 'chmonitor Overview with AI Insights: critical and warning findings — read-only replicas, detached parts, replication lag — beside live cluster vitals',
    },
    reverse: true,
  },
  {
    id: 'feature-peerdb',
    icon: 'git-branch',
    eyebrow: 'PeerDB replication',
    title: 'Watch your Postgres → ClickHouse CDC',
    description:
      'Point chmonitor at your PeerDB API and every mirror gets live status, rows-synced trends, lag triage and slot health — read-only, proxied, no agent.',
    bullets: [
      'Fleet view: running / snapshotting / paused / failed at a glance',
      'Per-mirror detail: batch history, partition sync progress, peer info',
      'Worst-lag triage strip and replication-slot health across peers',
      'Aggregated logs and alerts, filterable by severity',
    ],
    screenshot: {
      src: '/assets/screenshots/peerdb-overview-with-bg.png',
      alt: 'chmonitor PeerDB Mirrors: fleet status tiles, rows-synced trends, peer topology and pipeline phase',
    },
    learnMoreHref: 'https://docs.chmonitor.dev/guide/features/peerdb',
  },
  {
    id: 'feature-postgres',
    icon: 'database',
    eyebrow: 'Postgres · Beta',
    title: 'Monitor Postgres alongside ClickHouse',
    description:
      'Same dashboard, same read-only guarantees. Query insights from pg_stat_statements, live activity from pg_stat_activity, and agent tools — free on every plan while in beta.',
    bullets: [
      'Slowest query patterns from pg_stat_statements',
      'Live pg_stat_activity, refreshed every 5 seconds',
      'Every query pinned read-only, SSRF-guarded connections',
      'Three new AI agent tools for Postgres',
    ],
    screenshot: {
      src: '/assets/screenshots/add-postgres-host-with-bg.png',
      alt: 'Add Postgres source dialog: read-only connection, pg_stat_* requirements and encrypted credentials',
    },
    learnMoreHref: 'https://docs.chmonitor.dev/guide/features/postgres',
  },
]
