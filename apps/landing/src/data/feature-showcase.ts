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
      src: '/landing-assets/ai-agent-new-dark.webp',
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
      src: '/landing-assets/running-queries-new-dark.webp',
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
      src: '/landing-assets/cluster-topology-new-dark.webp',
      alt: 'Cluster topology map of shards, replicas and Keeper quorum',
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
      src: '/landing-assets/chmonitor-health-dark.png',
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
      src: '/landing-assets/data-explorer-new-dark.webp',
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
      // Not overview-insights-*: the hero already carries that capture.
      src: '/landing-assets/record-breakers-dark.webp',
      alt: 'Record-breaking queries ranked by duration, memory and rows read',
    },
    reverse: true,
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
      // Placeholder: no dedicated Postgres UI capture exists yet — this reuses
      // an unused query-focused dashboard shot. Swap for a real /postgres/queries
      // or /postgres/activity screenshot once available.
      src: '/landing-assets/queries-memory-dark.webp',
      alt: 'Query insights dashboard, the same pattern used for Postgres monitoring',
    },
    learnMoreHref: 'https://docs.chmonitor.dev/guide/features/postgres',
  },
]
