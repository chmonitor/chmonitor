/**
 * Detailed per-feature landing pages (/features/<slug>), rendered by
 * src/pages/features/[slug].astro. One rich entry per product feature —
 * hero, stat strip, alternating deep-dive sections with real screenshots,
 * capability grid, FAQ and cross-links. Screenshots come from the shared
 * repo-root assets/ library (synced to /assets/screenshots/ at build).
 *
 * Themed shots: `src` is the LIGHT variant (build-time default), `srcDark`
 * the dark one — Base.astro's chmSyncThemedImages() swaps them client-side.
 * Dark-only captures set `src` alone.
 */

export type FeatureShot = {
  src: string
  srcDark?: string
  alt: string
}

export type FeaturePageSection = {
  eyebrow: string
  title: string
  body: string
  bullets?: string[]
  screenshot: FeatureShot
  reverse?: boolean
}

export type FeaturePage = {
  slug: string
  /** <title> */
  title: string
  /** meta description */
  description: string
  eyebrow: string
  h1: string
  subhead: string
  hero: FeatureShot
  stats: { value: string; label: string }[]
  sections: FeaturePageSection[]
  gallery?: (FeatureShot & { caption: string })[]
  capabilities: { title: string; body: string }[]
  faq: { q: string; a: string }[]
  docsHref?: string
  related: string[]
}

const S = '/assets/screenshots'

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: 'ai-agent',
    title: 'AI Agent for ClickHouse — chmonitor',
    description:
      'A schema-aware AI agent for ClickHouse: 29 read-only tools across schema, diagnostics and optimization, MCP endpoint for Claude and Cursor, bring your own model.',
    eyebrow: 'AI Agent',
    h1: 'Ask your cluster anything',
    subhead:
      'The built-in agent reads schema and query_log before recommending anything. Connect over MCP from Claude, Cursor or any client — read-only, nothing applied without you.',
    hero: {
      src: `${S}/ai-agent-conversation-dark-with-bg.png`,
      alt: 'chmonitor AI agent conversation with schema-aware recommendations',
    },
    stats: [
      {
        value: '29',
        label: 'tools across schema, diagnostics and optimization',
      },
      { value: 'MCP', label: 'endpoint for Claude, Cursor and any client' },
      { value: 'BYOM', label: 'bring your own model and API key' },
      { value: 'Read-only', label: 'nothing applied without you' },
    ],
    sections: [
      {
        eyebrow: 'Grounded answers',
        title: 'It reads your cluster before it speaks',
        body: 'Every recommendation starts from your real schema, table stats and query_log — not generic advice. Ask why a query is slow and the agent inspects the statement, the parts it scans and the indexes it misses.',
        bullets: [
          'Schema, storage, replication, merges and health tools',
          'Recommend-only advisor: skip indexes, projections, PREWHERE rewrites',
          'Skill recipes for anything not covered by a primitive tool',
        ],
        screenshot: {
          src: `${S}/ai-agent-new-dark.webp`,
          alt: 'AI agent conversation analyzing a slow ClickHouse query',
        },
      },
      {
        eyebrow: 'MCP server',
        title: 'Bring your own client over MCP',
        body: 'chmonitor exposes the same tools on a Model Context Protocol endpoint at /api/mcp. Point Claude, Cursor or any MCP client at it and query your cluster from wherever you already work.',
        bullets: [
          'Open, API-key or Clerk OAuth auth postures',
          'Same read-only guarantees as the built-in agent',
          'Works on Cloudflare Workers, Docker and Kubernetes deploys',
        ],
        screenshot: {
          src: `${S}/mcp-server-light.png`,
          srcDark: `${S}/mcp-server-dark.png`,
          alt: 'chmonitor MCP server setup page with endpoint and client config',
        },
        reverse: true,
      },
      {
        eyebrow: 'Your model, your rules',
        title: 'Bring your own model, skills and servers',
        body: 'Pick the model, plug in your own API key, add skills and connect external MCP servers. The agent adapts to your stack instead of locking you into one vendor.',
        bullets: [
          'Anthropic, OpenAI, Google and OpenAI-compatible endpoints',
          'Per-message stats: tokens, duration, cost estimate',
          'Conversation history persisted per user',
        ],
        screenshot: {
          src: `${S}/ai-agent-settings-dark.webp`,
          alt: 'AI agent settings: model selection, API keys and skills',
        },
      },
    ],
    gallery: [
      {
        src: `${S}/ai-agent-starting-screen-dark-with-bg.png`,
        alt: 'AI agent starting screen with suggested prompts',
        caption: 'Suggested prompts to start from',
      },
      {
        src: `${S}/ai-agent-grok-4.5-with-bg.png`,
        alt: 'AI agent running on an alternative model',
        caption: 'Swap models without losing your tools',
      },
    ],
    capabilities: [
      {
        title: 'Schema tools',
        body: 'Databases, tables, columns, DDL and table stats on demand.',
      },
      {
        title: 'Query diagnostics',
        body: 'Slow, failed and expensive queries with EXPLAIN analysis.',
      },
      {
        title: 'Optimization advisor',
        body: 'Skip indexes, projections and PREWHERE rewrites — recommend-only.',
      },
      {
        title: 'Health & replication',
        body: 'Replication lag, merges, mutations and disk pressure checks.',
      },
      {
        title: 'Visualizations',
        body: 'The agent renders charts and tables inline in the conversation.',
      },
      {
        title: 'Skills',
        body: 'Loadable recipes extend the agent beyond its primitive tools.',
      },
    ],
    faq: [
      {
        q: 'Can the agent change my cluster?',
        a: 'No. The default toolset is read-only; the three destructive control tools ship disabled and must be explicitly enabled by environment variable.',
      },
      {
        q: 'Which models are supported?',
        a: 'Anthropic, OpenAI, Google and any OpenAI-compatible endpoint. Bring your own API key per provider.',
      },
      {
        q: 'Do I need the dashboard open to use MCP?',
        a: 'No. The MCP endpoint is served by the same deployment — connect from Claude, Cursor or any MCP client directly.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev/guide/ai-agent',
    related: ['insights', 'queries', 'data-explorer'],
  },
  {
    slug: 'queries',
    title: 'ClickHouse Query Monitoring — chmonitor',
    description:
      'Monitor running, slow, failed and expensive ClickHouse queries: live tables, heatmaps, EXPLAIN, kill from the UI, memory breakdowns and record-breaker insights.',
    eyebrow: 'Query monitoring',
    h1: 'Every query, explained',
    subhead:
      'Running, history, failed, slowest and most expensive queries — duration, memory, rows read and the full statement, in sortable tables backed by system.query_log.',
    hero: {
      src: `${S}/running-queries-new-dark-with-bg.png`,
      alt: 'Running queries with live charts and sortable table',
    },
    stats: [
      { value: 'Live', label: 'running queries with auto-refresh' },
      { value: '1 click', label: 'EXPLAIN or kill from the table' },
      { value: '365 days', label: 'query activity heatmap' },
      { value: 'Presets', label: 'saved filters for repeat triage' },
    ],
    sections: [
      {
        eyebrow: 'Live view',
        title: 'What is running right now',
        body: 'A live table of every executing query with elapsed time, memory, rows read and the user behind it. Long-runner misbehaving? Kill it from the row menu without opening a client.',
        bullets: [
          'Queries by user and top patterns over time',
          'Saved filter presets for repeat triage',
          'Full statement with SQL formatting on demand',
        ],
        screenshot: {
          src: `${S}/running-queries-new-dark.webp`,
          alt: 'Running queries table with live charts',
        },
      },
      {
        eyebrow: 'History',
        title: 'A year of activity at a glance',
        body: 'The query heatmap shows volume across a full year, and record-breaker insights surface the slowest, hungriest and most expensive statements your cluster has ever seen.',
        bullets: [
          'Heatmap of query volume by day',
          'Record-breakers: duration, memory and rows-read champions',
          'Failed queries with error classification',
        ],
        screenshot: {
          src: `${S}/query-heatmap-dark.webp`,
          alt: 'Query activity heatmap over a year',
        },
        reverse: true,
      },
      {
        eyebrow: 'Explain',
        title: 'From symptom to plan in one click',
        body: 'Open EXPLAIN for any statement to see the plan, the indexes used and the parts scanned — then hand it to the AI agent for a rewrite recommendation.',
        bullets: [
          'EXPLAIN plan and pipeline views',
          'Memory breakdown per query',
          'One-click handoff to the AI agent',
        ],
        screenshot: {
          src: `${S}/explain-new-dark.webp`,
          alt: 'EXPLAIN plan view for a ClickHouse query',
        },
      },
    ],
    gallery: [
      {
        src: `${S}/queries-memory-dark.webp`,
        alt: 'Query memory usage breakdown',
        caption: 'Memory usage per query',
      },
      {
        src: `${S}/record-breakers-dark.webp`,
        alt: 'Record-breaking queries insight cards',
        caption: 'Record-breaker insights',
      },
    ],
    capabilities: [
      {
        title: 'Running queries',
        body: 'Live table with elapsed, memory, rows and kill action.',
      },
      {
        title: 'Slow & expensive',
        body: 'Slowest and costliest statements ranked from query_log.',
      },
      {
        title: 'Failed queries',
        body: 'Errors grouped and classified for fast triage.',
      },
      { title: 'EXPLAIN', body: 'Plan and pipeline views for any statement.' },
      { title: 'Heatmap', body: 'A year of query volume in one visual.' },
      {
        title: 'By user',
        body: 'Who runs what — usage split by user and pattern.',
      },
    ],
    faq: [
      {
        q: 'Does query monitoring need an agent on my hosts?',
        a: 'No. Everything reads ClickHouse system tables (query_log, processes) over the native HTTP interface — no sidecar, no agent.',
      },
      {
        q: 'Can I kill a query from the dashboard?',
        a: 'Yes — the row action issues KILL QUERY. Control actions are permission-gated and can be disabled entirely.',
      },
      {
        q: 'Which ClickHouse versions are supported?',
        a: 'Queries are version-aware: chmonitor picks the right SQL for your server version, back to 23.x system table schemas.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev',
    related: ['ai-agent', 'insights', 'alerting'],
  },
  {
    slug: 'topology',
    title: 'ClickHouse Cluster Topology Map — chmonitor',
    description:
      'Interactive ClickHouse cluster topology: nodes, shards, replicas and Keeper quorum with live replication links, health states and per-node metrics.',
    eyebrow: 'Cluster topology',
    h1: 'See the whole cluster at a glance',
    subhead:
      'An interactive map of nodes, shards, replicas and Keeper quorum — live replication links, health states and per-node metrics, drawn from system tables.',
    hero: {
      src: `${S}/cluster-topo-viz-with-bg.png`,
      alt: 'chmonitor cluster topology map: Keeper quorum with leader and followers, ClickHouse shard nodes, virtual cluster overlays, and an inspector panel',
    },
    stats: [
      { value: 'Live', label: 'health states per node' },
      { value: 'Keeper', label: 'quorum with leader and followers' },
      { value: 'Virtual', label: 'overlapping logical clusters' },
      { value: '0 config', label: 'built from system tables' },
    ],
    sections: [
      {
        eyebrow: 'The map',
        title: 'Shards, replicas and Keeper in one picture',
        body: 'chmonitor draws your physical and logical clusters from system.clusters and system.zookeeper — ClickHouse nodes grouped by shard, replicas linked, and the Keeper ensemble with its current leader.',
        bullets: [
          'Physical and logical clusters, overlapping virtual clusters',
          'Replication links between replicas',
          'Inspector panel with quorum health and znode count',
        ],
        screenshot: {
          src: `${S}/cluster-topology-new-dark.webp`,
          alt: 'Cluster topology visualization with shards and replicas',
        },
      },
      {
        eyebrow: 'Node health',
        title: 'Per-node vitals, color-coded',
        body: 'Every node carries live CPU, memory and latency. Healthy, warning and unreachable states are visible from across the room — no drilling into host pages to find the sick replica.',
        bullets: [
          'Per-node CPU, memory and latency',
          'Healthy / warn / unreachable states',
          'Click any node for its detail view',
        ],
        screenshot: {
          src: `${S}/keeper.png`,
          alt: 'Keeper ensemble detail with quorum status',
        },
        reverse: true,
      },
    ],
    gallery: [
      {
        src: `${S}/cluster-topology-light.png`,
        srcDark: `${S}/cluster-topology-dark.png`,
        alt: 'Cluster topology in light and dark themes',
        caption: 'Light and dark themes',
      },
      {
        src: `${S}/overview-dark-with-bg.jpeg`,
        alt: 'Cluster overview dashboard',
        caption: 'Overview pairs with the map',
      },
    ],
    capabilities: [
      {
        title: 'Shard layout',
        body: 'Nodes grouped by shard with replica links.',
      },
      {
        title: 'Keeper quorum',
        body: 'Leader, followers and znode counts live.',
      },
      {
        title: 'Virtual clusters',
        body: 'Overlapping logical clusters rendered as overlays.',
      },
      { title: 'Node vitals', body: 'CPU, memory and latency per node.' },
      {
        title: 'Health states',
        body: 'Healthy, warning and unreachable at a glance.',
      },
      { title: 'Inspector', body: 'Click any element for its details.' },
    ],
    faq: [
      {
        q: 'Does it work without Keeper / ZooKeeper?',
        a: 'Yes. system.zookeeper is treated as optional — single-node and non-replicated setups render the map without the Keeper ensemble.',
      },
      {
        q: 'How is the topology discovered?',
        a: 'Entirely from system tables (clusters, replicas, zookeeper). No agents and no extra configuration.',
      },
      {
        q: 'Does the map update live?',
        a: 'Yes — health states and metrics refresh on the standard dashboard interval.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev',
    related: ['alerting', 'insights', 'queries'],
  },
  {
    slug: 'alerting',
    title: 'ClickHouse Alerting & Health Checks — chmonitor',
    description:
      'Built-in ClickHouse health checks with tunable thresholds: replication lag, disk, memory and failed queries. One webhook to Slack, Discord, PagerDuty or Opsgenie.',
    eyebrow: 'Alerting',
    h1: 'Know before your users do',
    subhead:
      'Built-in health checks watch replication lag, disk, memory and failed queries — each with tunable warning and critical thresholds and a full fire-and-recovery history.',
    hero: {
      src: `${S}/health-summary-with-bg.jpeg`,
      alt: 'Health checks with editable warning and critical thresholds',
    },
    stats: [
      { value: '1 webhook', label: 'Slack, Discord, PagerDuty or Opsgenie' },
      { value: 'Tunable', label: 'warning and critical thresholds per check' },
      { value: 'History', label: 'full fire and recovery timeline' },
      { value: 'AI audit', label: 'one-click prompt for failing checks' },
    ],
    sections: [
      {
        eyebrow: 'Health checks',
        title: 'The checks that matter, pre-built',
        body: 'Replication lag, disk pressure, memory, failed queries, detached parts and more — every check ships with sensible defaults and editable warning/critical thresholds.',
        bullets: [
          'Editable thresholds per check',
          'Fire and recovery history per check',
          'Per-host status rollup',
        ],
        screenshot: {
          src: `${S}/chmonitor-health-light.png`,
          srcDark: `${S}/chmonitor-health-dark.png`,
          alt: 'Health check list with thresholds and statuses',
        },
      },
      {
        eyebrow: 'Notifications',
        title: 'One webhook, every channel',
        body: 'Point chmonitor at a single webhook URL and alerts land in Slack, Discord, PagerDuty or Opsgenie — fired on threshold breach, resolved on recovery.',
        bullets: [
          'Breach and recovery notifications',
          'No per-channel integrations to maintain',
          'Works on every deploy target',
        ],
        screenshot: {
          src: `${S}/notify-getting-insights.png`,
          alt: 'Alert notification with insight summary',
        },
        reverse: true,
      },
      {
        eyebrow: 'AI audit',
        title: 'From alert to diagnosis in one click',
        body: 'Any failing check carries an AI audit action: it opens the agent with the check context pre-loaded, so the diagnosis starts from the failure, not from a blank prompt.',
        bullets: [
          'Check context handed to the agent automatically',
          'Schema-aware root-cause suggestions',
          'Read-only — the agent recommends, you apply',
        ],
        screenshot: {
          src: `${S}/health-audit.png`,
          alt: 'AI audit of a failing health check',
        },
      },
    ],
    capabilities: [
      { title: 'Replication lag', body: 'Warn before replicas fall behind.' },
      {
        title: 'Disk & memory',
        body: 'Capacity pressure with critical thresholds.',
      },
      { title: 'Failed queries', body: 'Error-rate spikes surfaced early.' },
      {
        title: 'Webhooks',
        body: 'Slack, Discord, PagerDuty, Opsgenie — one URL.',
      },
      { title: 'History', body: 'Every fire and recovery, timestamped.' },
      { title: 'AI audit', body: 'One-click diagnosis for any failing check.' },
    ],
    faq: [
      {
        q: 'Do I need an external alerting stack?',
        a: 'No. Checks are evaluated by chmonitor itself; you only supply a webhook URL for delivery.',
      },
      {
        q: 'Can I change what counts as critical?',
        a: 'Yes — every check has editable warning and critical thresholds, per check.',
      },
      {
        q: 'Will I get a notification when things recover?',
        a: 'Yes, recovery fires its own notification and is recorded in the check history.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev',
    related: ['topology', 'insights', 'queries'],
  },
  {
    slug: 'data-explorer',
    title: 'ClickHouse Data Explorer — chmonitor',
    description:
      'Browse ClickHouse databases and tables, map dependencies between materialized views, dictionaries and sources, and run SQL — without leaving the dashboard.',
    eyebrow: 'Data Explorer',
    h1: 'Explore tables and how they connect',
    subhead:
      'Browse every database and table, map dependencies between them, then drop into SQL — all without leaving the dashboard.',
    hero: {
      src: `${S}/data-explorer-new-dark-with-bg.png`,
      alt: 'Data explorer dependency graph between tables',
    },
    stats: [
      { value: 'Graph', label: 'materialized views, dictionaries, sources' },
      { value: 'SQL', label: 'console with timing and history' },
      { value: 'DDL', label: 'and parts inspection per table' },
      { value: 'Lineage', label: 'projections and skip indexes visible' },
    ],
    sections: [
      {
        eyebrow: 'Dependency graph',
        title: 'How your tables feed each other',
        body: 'Materialized views, dictionaries and their source tables drawn as a live graph. Trace where data flows before you drop, rename or backfill anything.',
        bullets: [
          'MV chains and dictionary sources',
          'Click-through to any table detail',
          'Lineage at a glance',
        ],
        screenshot: {
          src: `${S}/data-explorer-graph-light.png`,
          srcDark: `${S}/data-explorer-graph-dark.png`,
          alt: 'Dependency graph of materialized views and source tables',
        },
      },
      {
        eyebrow: 'SQL console',
        title: 'Run SQL where the context is',
        body: 'A console with row counts, timing, history and EXPLAIN — plus DDL and parts inspection for the table you are looking at. No context switch to a separate client.',
        bullets: [
          'Query history and timing',
          'DDL, projections and skip indexes per table',
          'Parts and partitions inspection',
        ],
        screenshot: {
          src: `${S}/data-explorer-query.png`,
          alt: 'SQL console inside the data explorer',
        },
        reverse: true,
      },
    ],
    gallery: [
      {
        src: `${S}/data-explorer-new-dark.webp`,
        alt: 'Data explorer table browser',
        caption: 'Every database and table, browsable',
      },
      {
        src: `${S}/explain-new-dark.webp`,
        alt: 'EXPLAIN inside the SQL console',
        caption: 'EXPLAIN without leaving the page',
      },
    ],
    capabilities: [
      {
        title: 'Table browser',
        body: 'Every database, table and column with sizes.',
      },
      {
        title: 'Dependency graph',
        body: 'MVs, dictionaries and sources, linked.',
      },
      { title: 'SQL console', body: 'Row counts, timing, history, EXPLAIN.' },
      { title: 'DDL view', body: 'SHOW CREATE for any object.' },
      { title: 'Parts', body: 'Parts and partitions per table.' },
      { title: 'Indexes', body: 'Projections and skip indexes surfaced.' },
    ],
    faq: [
      {
        q: 'Is the SQL console read-only?',
        a: 'It runs with the credentials you configured; pair it with a read-only ClickHouse user for a strictly read-only console.',
      },
      {
        q: 'Does the graph handle big schemas?',
        a: 'Yes — the graph is scoped per database/table neighborhood so thousand-table schemas stay navigable.',
      },
      {
        q: 'Can I see why a table is large?',
        a: 'Table detail shows compressed/uncompressed sizes, parts and partitions to find the weight.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev',
    related: ['queries', 'ai-agent', 'insights'],
  },
  {
    slug: 'insights',
    title: 'ClickHouse Insights & Cluster Vitals — chmonitor',
    description:
      'AI-generated ClickHouse findings, record-breaking queries, storage stats and a year of activity — surfaced automatically, no dashboards to build.',
    eyebrow: 'Insights',
    h1: "Know your cluster's vitals",
    subhead:
      'Record-breaking queries, storage stats and a full year of activity — surfaced automatically, no dashboards to build.',
    hero: {
      src: `${S}/cluster-insights-dark-with-bg.jpeg`,
      alt: 'chmonitor Overview with AI Insights: critical and warning findings beside live cluster vitals',
    },
    stats: [
      { value: 'Auto', label: 'findings generated on a schedule' },
      { value: 'Stable', label: 'dismissal keys — no re-noise' },
      { value: '365 days', label: 'of activity in one heatmap' },
      { value: '0 setup', label: 'no dashboards to build' },
    ],
    sections: [
      {
        eyebrow: 'AI findings',
        title: 'Problems surface themselves',
        body: 'The insights engine collects, enriches and persists findings — read-only replicas, detached parts, replication lag — ranked by severity on the overview. Dismiss a finding and it stays dismissed thanks to stable keys.',
        bullets: [
          'Critical and warning findings, ranked',
          'Stable-key dismissal — dismissed stays dismissed',
          'Cron and manual generation',
        ],
        screenshot: {
          src: `${S}/overview-insights-dark.webp`,
          alt: 'AI insights panel with ranked findings',
        },
      },
      {
        eyebrow: 'Vitals',
        title: 'The charts you would have built anyway',
        body: 'Query volume, memory, storage by database and table, merges and replication — the standard ClickHouse operating picture, pre-built and live.',
        bullets: [
          'Storage breakdown by database, table and part',
          'Query and merge activity over time',
          'Per-host metric charts',
        ],
        screenshot: {
          src: `${S}/overview-charts-detailed-light.png`,
          srcDark: `${S}/overview-charts-detailed-dark.png`,
          alt: 'Detailed overview charts of cluster vitals',
        },
        reverse: true,
      },
      {
        eyebrow: 'Records',
        title: 'Your cluster’s hall of fame',
        body: 'Record-breakers track the slowest, hungriest and most expensive statements ever seen, and the heatmap compresses a year of query volume into one glance.',
        bullets: [
          'Duration, memory and rows-read champions',
          'Query activity heatmap over a year',
          'Jump from a record straight to the statement',
        ],
        screenshot: {
          src: `${S}/record-breakers-dark.webp`,
          alt: 'Record-breaking queries insight',
        },
      },
    ],
    gallery: [
      {
        src: `${S}/query-heatmap-dark.webp`,
        alt: 'Query heatmap',
        caption: 'A year of volume at a glance',
      },
      {
        src: `${S}/g-metrics.png`,
        alt: 'Metric charts',
        caption: 'Live metric charts',
      },
    ],
    capabilities: [
      {
        title: 'AI findings',
        body: 'Collected, enriched, persisted — with severity.',
      },
      {
        title: 'Dismissal',
        body: 'Stable keys keep dismissed findings quiet.',
      },
      { title: 'Storage stats', body: 'By database, table and part.' },
      { title: 'Heatmap', body: 'A year of query activity.' },
      { title: 'Record-breakers', body: 'All-time query champions.' },
      { title: 'SQL console', body: 'History, EXPLAIN and scan analysis.' },
    ],
    faq: [
      {
        q: 'Where do findings come from?',
        a: 'A collect → enrich → persist pipeline over system tables, run on a schedule or on demand — optionally enriched by the AI agent.',
      },
      {
        q: 'Will dismissed findings come back?',
        a: 'Not unless the underlying condition changes: findings carry stable keys, so the same finding stays dismissed.',
      },
      {
        q: 'Do I need to configure any dashboards?',
        a: 'No. The overview, charts and insights are built in and live immediately after connecting a host.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev',
    related: ['ai-agent', 'queries', 'alerting'],
  },
  {
    slug: 'peerdb',
    title: 'PeerDB CDC Monitoring — chmonitor',
    description:
      'Monitor Postgres → ClickHouse CDC with PeerDB: live mirror status, rows-synced trends, lag triage, slot health, logs and alerts — read-only, no agent.',
    eyebrow: 'PeerDB replication',
    h1: 'Watch your Postgres → ClickHouse CDC',
    subhead:
      'Point chmonitor at your PeerDB API and every mirror gets live status, rows-synced trends, lag triage and slot health — read-only, proxied, no agent.',
    hero: {
      src: `${S}/peerdb-overview-with-bg.png`,
      alt: 'chmonitor PeerDB Mirrors: fleet status tiles, rows-synced trends, peer topology and pipeline phase',
    },
    stats: [
      { value: 'Fleet', label: 'running / snapshotting / paused / failed' },
      { value: 'Lag', label: 'worst-lag triage strip' },
      { value: 'Slots', label: 'replication-slot health across peers' },
      { value: 'Read-only', label: 'proxied API, no agent' },
    ],
    sections: [
      {
        eyebrow: 'Fleet view',
        title: 'Every mirror on one screen',
        body: 'Status tiles for the whole fleet — running, snapshotting, paused, failed — with rows-synced trends and the worst-lag strip pointing at the mirror that needs you first.',
        bullets: [
          'Live status per mirror',
          'Rows-synced trends over time',
          'Worst-lag triage strip',
        ],
        screenshot: {
          src: `${S}/peerdb-new-dark.webp`,
          alt: 'PeerDB mirrors fleet view',
        },
      },
      {
        eyebrow: 'Mirror detail',
        title: 'Drill into any pipeline',
        body: 'Batch history, partition sync progress, peer info and pipeline phase per mirror — plus aggregated logs and alerts filterable by severity.',
        bullets: [
          'Batch history and partition progress',
          'Replication-slot health across peers',
          'Logs and alerts, filterable by severity',
        ],
        screenshot: {
          src: `${S}/peerdb-detail-with-bg.png`,
          alt: 'PeerDB mirror detail with batch history',
        },
        reverse: true,
      },
    ],
    gallery: [
      {
        src: `${S}/peerdb-mirrors-dark.png`,
        alt: 'PeerDB mirrors list',
        caption: 'Mirrors with phase and status',
      },
    ],
    capabilities: [
      { title: 'Fleet status', body: 'All mirrors and their phases, live.' },
      { title: 'Sync trends', body: 'Rows synced over time per mirror.' },
      { title: 'Lag triage', body: 'Worst lag surfaced first.' },
      { title: 'Slot health', body: 'Replication slots across peers.' },
      { title: 'Logs & alerts', body: 'Aggregated, severity-filterable.' },
      { title: 'No agent', body: 'Read-only proxy to the PeerDB API.' },
    ],
    faq: [
      {
        q: 'What do I need to connect?',
        a: 'Just your PeerDB API endpoint and credentials — chmonitor proxies read-only requests, no agent on either side.',
      },
      {
        q: 'Can chmonitor pause or edit mirrors?',
        a: 'No. The integration is strictly read-only monitoring.',
      },
      {
        q: 'Does this replace PeerDB’s own UI?',
        a: 'It complements it: chmonitor puts CDC health next to your ClickHouse and Postgres monitoring in one dashboard.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev/guide/features/peerdb',
    related: ['postgres', 'topology', 'alerting'],
  },
  {
    slug: 'postgres',
    title: 'Postgres Monitoring (Beta) — chmonitor',
    description:
      'Monitor Postgres alongside ClickHouse: pg_stat_statements query insights, live pg_stat_activity, read-only pinned connections and AI agent tools. Free while in beta.',
    eyebrow: 'Postgres · Beta',
    h1: 'Monitor Postgres alongside ClickHouse',
    subhead:
      'Same dashboard, same read-only guarantees. Query insights from pg_stat_statements, live activity from pg_stat_activity, and agent tools — free on every plan while in beta.',
    hero: {
      src: `${S}/add-postgres-host-with-bg.png`,
      alt: 'Add Postgres source dialog: read-only connection, pg_stat_* requirements and encrypted credentials',
    },
    stats: [
      { value: 'Beta', label: 'free on every plan' },
      { value: 'Read-only', label: 'every query pinned read-only' },
      { value: '5s', label: 'pg_stat_activity refresh' },
      { value: '3 tools', label: 'new AI agent tools for Postgres' },
    ],
    sections: [
      {
        eyebrow: 'Connect',
        title: 'One dialog, guarded by design',
        body: 'Add a Postgres source with a read-only connection: SSRF-guarded URLs, encrypted credentials and clear pg_stat_* prerequisites, checked before you save.',
        bullets: [
          'Every query pinned read-only at the driver',
          'SSRF-guarded connections, encrypted credentials',
          'pg_stat_statements requirement checked upfront',
        ],
        screenshot: {
          src: `${S}/add-pg-source-light.png`,
          srcDark: `${S}/add-pg-source-dark.png`,
          alt: 'Add Postgres source dialog',
        },
      },
      {
        eyebrow: 'Query insights',
        title: 'The slowest patterns, ranked',
        body: 'pg_stat_statements powers slow-pattern ranking; pg_stat_activity gives a live view of what runs right now, refreshed every five seconds — the same triage flow you use for ClickHouse.',
        bullets: [
          'Slowest query patterns from pg_stat_statements',
          'Live activity, refreshed every 5 seconds',
          'Three new AI agent tools for Postgres',
        ],
        screenshot: {
          src: `${S}/ai-agent-dark.png`,
          alt: 'AI agent answering a Postgres monitoring question',
        },
        reverse: true,
      },
    ],
    capabilities: [
      {
        title: 'Slow patterns',
        body: 'pg_stat_statements ranking, normalized.',
      },
      { title: 'Live activity', body: 'pg_stat_activity every 5 seconds.' },
      { title: 'Read-only', body: 'Pinned at the connection, always.' },
      { title: 'SSRF guard', body: 'Connection URLs validated server-side.' },
      { title: 'Agent tools', body: 'Three Postgres tools for the AI agent.' },
      { title: 'One dashboard', body: 'Postgres next to ClickHouse, same UX.' },
    ],
    faq: [
      {
        q: 'Is Postgres monitoring extra?',
        a: 'No — it is free on every plan while in beta.',
      },
      {
        q: 'What does chmonitor need on my Postgres?',
        a: 'A read-only user and the pg_stat_statements extension for query insights; live activity works with pg_stat_activity out of the box.',
      },
      {
        q: 'Can it write to my database?',
        a: 'No. Every query is pinned read-only at the driver level.',
      },
    ],
    docsHref: 'https://docs.chmonitor.dev/guide/features/postgres',
    related: ['peerdb', 'queries', 'ai-agent'],
  },
]

export function getFeaturePage(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((p) => p.slug === slug)
}
