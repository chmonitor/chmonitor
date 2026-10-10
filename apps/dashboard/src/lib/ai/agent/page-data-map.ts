/**
 * Dashboard page → data sources, for the `get_page_data` agent tool.
 *
 * Each entry names the table `QueryConfig`s (resolved by `getTableQuery`) and
 * the chart builders (resolved by `getChartQuery`) a page renders, so the agent
 * can answer "what does the X page show?" with the same queries the page runs.
 *
 * Static on purpose: route files and page components are React code the
 * server bundle should not import. `__tests__/page-data-map.test.ts` keeps it
 * honest — it scans `routes/(dashboard)/**` for every `queryConfig` /
 * `chartName` a page references and every menu href, and fails when one is
 * missing here (or from `NON_DATA_PAGES`).
 *
 * Keys are route paths without the `(dashboard)` group and without a trailing
 * slash. The Overview page has one entry per tab (`/overview/<tab>`), because
 * running all 60 of its charts in one call would blow the output budget.
 */

export interface PageDataEntry {
  /** Page title as the sidebar shows it. */
  title: string
  /** Sidebar section, for the page listing. */
  section: string
  /** Table QueryConfig names (`QueryConfig.name`). */
  configs: readonly string[]
  /** Chart builder names (`chartName`). */
  charts: readonly string[]
}

const p = (
  title: string,
  section: string,
  configs: readonly string[],
  charts: readonly string[] = []
): PageDataEntry => ({ title, section, configs, charts })

const OVERVIEW = 'Overview'
const QUERIES = 'Queries'
const DATA = 'Data & Storage'
const CLUSTER = 'Cluster & Replication'
const SERVER = 'Server'
const ALERTS = 'Alerts & Insights'
const TOOLS = 'Tools & AI'
const SETTINGS = 'Settings'

export const PAGE_DATA_MAP: Readonly<Record<string, PageDataEntry>> = {
  // ── Overview (one entry per tab) ──
  '/overview': p(
    'Overview',
    OVERVIEW,
    [],
    [
      'connections-pool',
      'cpu-usage',
      'disk-size-all',
      'failed-query-count',
      'memory-usage',
      'merge-count',
      'mutation-progress',
      'new-parts-created',
      'query-count',
      'query-count-by-user',
      'query-count-heatmap',
      'query-duration',
      'query-duration-percentiles',
      'thread-utilization',
      'top-memory-queries',
      'top-table-size',
    ]
  ),
  '/overview/queries': p(
    'Overview: Queries tab',
    OVERVIEW,
    [],
    [
      'insert-performance',
      'query-cache',
      'query-cache-usage',
      'query-count-by-user',
      'query-count-heatmap',
      'query-duration-percentiles',
      'query-duration-trend',
      'query-memory',
      'query-type',
      'top-inserters',
      'top-query-fingerprints-perf',
    ]
  ),
  '/overview/memory-cpu': p(
    'Overview: Memory & CPU tab',
    OVERVIEW,
    [],
    [
      'cpu-load-average',
      'cpu-mode-split',
      'memory-breakdown',
      'thread-pool-utilization',
    ]
  ),
  '/overview/storage': p(
    'Overview: Storage tab',
    OVERVIEW,
    [],
    [
      'backup-size',
      'compression-ratio',
      'data-freshness',
      'disk-size',
      'disk-usage-by-database',
      'new-parts-created',
      'partition-part-health-summary',
      'parts-per-table',
      'top-table-size',
    ]
  ),
  '/overview/operations': p(
    'Overview: Operations tab',
    OVERVIEW,
    [],
    [
      'merge-avg-duration',
      'merge-count',
      'merge-sum-read-rows',
      'mutation-progress',
      'readonly-replica',
      'replication-lag',
      'replication-queue-count',
      'replication-summary-table',
      'summary-stuck-mutations',
      'summary-used-by-merges',
    ]
  ),
  '/overview/health': p(
    'Overview: Health tab',
    OVERVIEW,
    [],
    [
      'cancelled-queries',
      'connections-pool',
      'crash-frequency',
      'error-rate-over-time',
      'failed-query-count',
      'failed-query-count-by-user',
      'zookeeper-exception',
      'log-level-distribution',
      'oom-killed-queries',
      'slow-query-occurrences',
      'zookeeper-requests',
      'zookeeper-wait',
    ]
  ),

  // ── Queries ──
  '/running-queries': p(
    'Running Queries',
    QUERIES,
    ['running-queries'],
    ['query-count', 'query-count-by-user', 'query-count-today', 'query-memory']
  ),
  '/user-processes': p('User Processes', QUERIES, ['user-processes']),
  '/history-queries': p(
    'History Queries',
    QUERIES,
    ['history-queries'],
    [
      'query-count',
      'query-duration',
      'query-duration-percentiles',
      'query-memory',
      'query-count-by-user',
      'top-query-fingerprints',
      'cancelled-queries',
    ]
  ),
  '/recent-queries': p(
    'Recent Queries',
    QUERIES,
    ['recent-queries'],
    ['query-count', 'query-duration', 'query-memory']
  ),
  '/failed-queries': p(
    'Failed Queries',
    QUERIES,
    ['failed-queries'],
    ['failed-query-count', 'failed-query-count-by-user']
  ),
  '/query-views-log': p(
    'Query Views Log',
    QUERIES,
    ['query-views-log'],
    ['query-duration-trend', 'top-query-fingerprints-perf']
  ),
  '/query-metric-log': p(
    'Query Metric Log',
    QUERIES,
    ['query-metric-log'],
    ['query-metric-log-memory']
  ),
  '/slow-queries': p('Slow Queries', QUERIES, ['slow-queries']),
  '/slow-query-patterns': p('Slow Query Patterns', QUERIES, [
    'slow-query-patterns',
  ]),
  '/expensive-queries': p('Most Expensive Queries', QUERIES, [
    'expensive-queries',
  ]),
  '/expensive-queries-by-memory': p('Expensive Queries by Memory', QUERIES, [
    'expensive-queries-by-memory',
  ]),
  '/top-cpu-queries': p('Top CPU Queries', QUERIES, ['top-cpu-queries']),
  '/top-memory-queries': p('Top Memory Queries', QUERIES, [
    'top-memory-queries-live',
  ]),
  '/queries/insights': p(
    'Query Insights',
    QUERIES,
    [],
    [
      'query-insights-cache-hit-ratio',
      'query-insights-duration-distribution',
      'query-insights-errors',
      'query-insights-errors-by-code',
      'query-insights-hot-tables',
      'query-insights-latency',
      'query-insights-memory',
      'query-insights-memory-distribution',
      'query-insights-operations',
      'query-insights-qps',
      'query-insights-read-bytes-distribution',
      'query-insights-read-rows-distribution',
      'query-insights-read-throughput',
      'query-insights-rows',
      'query-insights-top-users',
    ]
  ),
  '/queries/thread-analysis': p(
    'Thread & Parallelization',
    QUERIES,
    ['thread-analysis'],
    ['thread-utilization', 'parallelization-efficiency']
  ),
  '/queries/parallelization': p(
    'Parallelization',
    QUERIES,
    ['parallelization'],
    ['parallelization-efficiency', 'thread-utilization']
  ),
  '/query-cache': p(
    'Query Cache',
    QUERIES,
    ['query-cache'],
    ['query-cache', 'query-cache-usage']
  ),
  '/query-condition-cache': p(
    'Query Condition Cache',
    QUERIES,
    ['query-condition-cache'],
    ['query-cache']
  ),
  '/common-errors': p('Common Errors', QUERIES, ['common-errors']),

  // ── Data & Storage ──
  '/tables-overview': p('Tables Overview', DATA, ['tables-overview']),
  '/dictionaries': p(
    'Dictionaries',
    DATA,
    ['dictionaries'],
    ['dictionary-count']
  ),
  '/merges': p(
    'Merges',
    DATA,
    ['merges', 'recent-merges'],
    ['summary-used-by-merges', 'merge-count']
  ),
  '/merge-performance': p(
    'Merge Performance',
    DATA,
    ['merge-performance'],
    ['merge-avg-duration', 'merge-sum-read-rows']
  ),
  '/mutations': p(
    'Mutations',
    DATA,
    ['mutations'],
    ['summary-stuck-mutations', 'summary-used-by-mutations', 'merge-count']
  ),
  '/moves': p('Moves', DATA, ['moves']),
  '/part-log': p('Part Log', DATA, ['part-log'], ['part-log-lifecycle']),
  '/part-info': p('Part Info', DATA, ['part-info']),
  '/detached-parts': p('Detached Parts', DATA, ['detached_parts']),
  '/ttl-partition-health': p(
    'TTL & Partitions',
    DATA,
    ['ttl-partition-health'],
    ['partition-part-health', 'parts-per-table']
  ),
  '/dropped-tables': p('Dropped Tables', DATA, ['dropped-tables']),
  '/readonly-tables': p(
    'Readonly Tables',
    DATA,
    ['readonly-tables'],
    ['readonly-replica']
  ),
  '/view-refreshes': p('View Refreshes', DATA, ['view-refreshes']),
  '/index-analytics': p('Index & Projection Analytics', DATA, [
    'index-analytics',
    'projection-analytics',
  ]),
  '/projections': p('Projections', DATA, ['projections']),
  '/asynchronous-inserts': p('Async Inserts', DATA, [
    'asynchronous-inserts',
    'asynchronous-insert-log',
  ]),
  '/kafka-consumers': p('Kafka Consumers', DATA, ['kafka-consumers']),
  '/rabbitmq-consumers': p('RabbitMQ Consumers', DATA, ['rabbitmq-consumers']),
  '/disks': p(
    'Disks',
    DATA,
    ['disks'],
    ['disk-size', 'disks-usage', 'disk-usage-trend']
  ),
  '/storage-economics': p('Storage Economics', DATA, [
    'storage-compression',
    'storage-policies',
    'ttl-storage-moves',
  ]),
  '/blob-storage-log': p('Blob Storage Log', DATA, ['blob-storage-log']),
  '/backups': p('Backups', DATA, ['backups'], ['backup-size']),
  '/top-usage-tables': p('Top Usage Tables', DATA, ['top-usage-tables']),
  '/top-usage-columns': p('Top Usage Columns', DATA, ['top-usage-columns']),

  // ── Cluster & Replication ──
  '/clusters': p('Clusters', CLUSTER, ['clusters']),
  '/clusters/replicas-status': p('Replicas Status', CLUSTER, [
    'replicas-status',
  ]),
  '/replicas': p(
    'Table Replicas',
    CLUSTER,
    ['replicas'],
    ['replication-queue-count', 'replication-summary-table']
  ),
  '/replication-queue': p(
    'Replication Queue',
    CLUSTER,
    ['replication-queue'],
    ['replication-queue-count', 'replication-summary-table']
  ),
  '/replicated-fetches': p('Replicated Fetches', CLUSTER, [
    'replicated-fetches',
  ]),
  '/distributed-ddl-queue': p('DDL Queue', CLUSTER, ['distributed-ddl-queue']),
  '/keeper': p(
    'Keeper Data Browser',
    CLUSTER,
    ['zookeeper'],
    [
      'zookeeper-requests',
      'zookeeper-wait',
      'zookeeper-uptime',
      'zookeeper-summary-table',
      'zookeeper-exception',
    ]
  ),
  '/keeper/overview': p(
    'Keeper Overview',
    CLUSTER,
    ['keeper-overview'],
    [
      'zookeeper-requests',
      'keeper-bytes',
      'zookeeper-wait',
      'keeper-connection-events',
      'keeper-operation-mix',
      'zookeeper-exception',
    ]
  ),
  '/keeper/info': p('Keeper Info', CLUSTER, ['keeper-info']),
  '/keeper/connections': p('Keeper Connections', CLUSTER, [
    'keeper-connections',
  ]),
  '/keeper/connection-log': p('Keeper Connection Log', CLUSTER, [
    'keeper-connection-log',
  ]),
  '/keeper/log': p('Keeper Request Log', CLUSTER, ['keeper-log']),
  '/keeper/watches': p('Keeper Watches', CLUSTER, ['keeper-watches']),
  '/keeper/deep-dive': p('Keeper Deep-dive', CLUSTER, [
    'keeper-cluster',
    'keeper-snapshots',
    'keeper-changelogs',
  ]),

  // ── Server ──
  '/metrics': p('Metrics', SERVER, ['metrics']),
  '/asynchronous-metrics': p('Async Metrics', SERVER, ['asynchronous-metrics']),
  '/histogram-metrics': p('Histogram Metrics', SERVER, [
    'histogram-metrics',
    'latency-log',
  ]),
  '/profiler': p('Profiler', SERVER, ['profiler'], ['thread-utilization']),
  '/logs/text-log': p(
    'Text Log',
    SERVER,
    ['text-log'],
    ['log-level-distribution', 'error-rate-over-time']
  ),
  '/logs/stack-traces': p('Stack Traces', SERVER, ['stack-traces']),
  '/logs/crashes': p('Crashes', SERVER, ['crash-log'], ['crash-frequency']),
  '/errors': p('Errors', SERVER, ['errors'], ['zookeeper-exception']),
  '/opentelemetry-spans': p('OpenTelemetry Spans', SERVER, [
    'opentelemetry-spans',
  ]),
  '/background-schedule-pool': p('Background Schedule Pool', SERVER, [
    'background-schedule-pool',
    'background-schedule-pool-log',
  ]),
  '/workload-scheduling': p('Workload Scheduling', SERVER, [
    'workloads',
    'scheduler',
  ]),
  '/warnings': p('Warnings', SERVER, ['warnings']),
  '/page-views': p(
    'Page Views',
    SERVER,
    ['page-views'],
    ['page-view', 'top-pages', 'human-vs-bot-pageviews', 'pageviews-by-device']
  ),
  '/users': p('Users', SERVER, ['users']),
  '/roles': p('Roles', SERVER, ['roles']),
  '/security/sessions': p(
    'Sessions',
    SERVER,
    ['sessions'],
    ['login-success-rate', 'active-sessions-count']
  ),
  '/security/login-attempts': p(
    'Login Attempts',
    SERVER,
    ['login-attempts'],
    ['login-success-rate', 'failed-login-by-user']
  ),
  '/security/audit-log': p(
    'Audit Log',
    SERVER,
    ['sessions'],
    ['login-success-rate', 'active-sessions-count']
  ),

  // ── Alerts & Insights ──
  '/insights': p(
    'Insights',
    ALERTS,
    [],
    [
      'insight-total-queries',
      'insight-total-scanned',
      'insight-total-rows-read',
      'insight-peak-memory',
      'insight-busiest-day-queries',
      'insight-busiest-day-bytes',
      'insight-busiest-second',
      'insight-avg-duration',
      'insight-error-rate',
      'insight-active-queries',
      'insight-current-memory',
      'insight-http-connections',
      'insight-active-merges',
      'insight-active-parts',
      'insight-detached-parts',
      'insight-active-mutations',
      'insight-largest-scan',
      'insight-fastest-scan',
      'insight-longest-query',
      'insight-total-storage',
      'insight-top-tables-by-size',
      'insight-compression-ratios',
    ]
  ),
  '/health': p(
    'Health and Alert',
    ALERTS,
    [],
    [
      'health-delayed-inserts',
      'health-disk-percent',
      'health-failed-backups',
      'health-failed-mutations',
      'health-failed-queries-recent',
      'health-keeper-exceptions-recent',
      'health-long-running-queries',
      'health-max-part-count',
      'health-memory-percent',
      'health-mv-refresh-failures',
      'health-oom-killed-recent',
      'health-parts-pressure',
      'health-query-timeouts',
      'health-readonly-replicas',
      'health-replication-lag',
      'health-stuck-merges',
      'health-ttl-partition-health',
    ]
  ),
  '/traffic': p(
    'Traffic',
    ALERTS,
    ['traffic-per-table'],
    [
      'traffic-summary',
      'traffic-cluster-shape',
      'traffic-insert-queries',
      'traffic-inserted-rows',
      'traffic-inserted-bytes',
      'traffic-ingest-speed',
      'traffic-insert-performance',
      'traffic-bytes-on-disk',
      'traffic-disk-write-speed',
      'traffic-merged-bytes',
      'traffic-part-moves',
      'traffic-write-amplification',
      'traffic-compression',
      'traffic-part-log-detect',
      'traffic-peerdb-detect',
    ]
  ),

  // ── Tools & AI ──
  '/dashboard': p(
    'Chart Builder (saved dashboard widgets)',
    TOOLS,
    [],
    ['dashboard-charts']
  ),

  // ── Settings ──
  '/settings': p('Settings', SETTINGS, ['settings']),
  '/mergetree-settings': p('MergeTree Settings', SETTINGS, [
    'mergetree-settings',
  ]),
  '/replicated-merge-tree-settings': p(
    'Replicated MergeTree Settings',
    SETTINGS,
    ['replicated-merge-tree-settings']
  ),
}

/**
 * Pages with no ClickHouse data of their own to replay: forms, settings
 * stores, redirects, interactive tools, hub/link pages, and sources another
 * tool family owns (Postgres, PeerDB). Each value says why, so the coverage
 * test's failure message points at the decision rather than a bare list.
 */
export const NON_DATA_PAGES: Readonly<Record<string, string>> = {
  '/about': 'static about page',
  '/advisor': 'interactive advisor; use get_optimization_recommendations',
  '/agents': 'the agent chat itself',
  '/agents/settings': 'agent settings form',
  '/ai-chat': 'redirect to the agent chat',
  '/alert-settings': 'alert settings form (metadata store, not ClickHouse)',
  '/charts': 'generic chart viewer; pass a chart name to get_page_data',
  '/cluster': 'redirect to /clusters',
  '/explain': 'interactive EXPLAIN tool; use explain_query',
  '/explorer': 'schema browser; use list_databases / get_table_schema',
  '/fleet': 'multi-host fleet view across every host',
  '/health-settings': 'health settings form',
  '/hub/cluster-replication': 'section hub page of links',
  '/hub/data-storage': 'section hub page of links',
  '/hub/queries': 'section hub page of links',
  '/hub/server': 'section hub page of links',
  '/inbound-events': 'inbound webhook events (metadata store)',
  '/insights-settings': 'insights settings form',
  '/mcp': 'MCP server setup docs',
  '/mcp-servers': 'MCP server configuration',
  '/peerdb': 'PeerDB mirrors; use the PeerDB tools',
  '/peerdb/peers': 'PeerDB peers; use the PeerDB tools',
  '/postgres/activity': 'Postgres source; use the Postgres tools',
  '/postgres/queries': 'Postgres source; use the Postgres tools',
  '/query': 'single-query detail; needs a query_id, use the query tools',
  '/report-settings': 'scheduled report settings form',
  '/schema-diff': 'interactive schema compare across hosts',
  '/security/management': 'RBAC grant/revoke forms',
  '/settings-diff': 'interactive settings diff across hosts',
  '/setup': 'first-run setup page',
  '/sql': 'SQL console; use the query tool',
  '/table': 'single-table detail; use get_table_schema / get_table_parts',
  '/tables': 'redirect to /table',
  '/zookeeper': 'redirect to /keeper',
}

/** Normalize a route-ish input: strip host query, group, trailing slash. */
export function normalizePageKey(input: string): string {
  let raw = input.trim().toLowerCase()
  raw = raw.replace(/^https?:\/\/[^/]+/, '')
  const [pathPart, query = ''] = raw.split('?')
  let path = pathPart.replace(/^\/?\(dashboard\)/, '')
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/+$/, '') || '/'
  // Overview tabs live in `?tab=`; the map keys them as `/overview/<tab>`.
  if (path === '/overview') {
    const tab = new URLSearchParams(query).get('tab')
    if (tab && tab !== 'overview') path = `/overview/${tab}`
  }
  return path
}
