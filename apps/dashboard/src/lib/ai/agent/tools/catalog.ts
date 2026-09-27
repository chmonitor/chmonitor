/**
 * Declarative catalog for the agent's tool surface.
 *
 * ## Why a side table
 *
 * The agent ships 40 tools in one flat namespace, and the system prompt's
 * `TOOL_LIST` is a flat prose list of names. That gives the model no routing
 * help beyond the names, and it left the tool list documented in four
 * hand-maintained places (this file, the module docblock in `index.ts`,
 * `docs/content/guide/ai-agent/capabilities.mdx`, and the prompt) — which had
 * already drifted: the `index.ts` docblock was missing
 * `forecast_disk_capacity`, `suggest_ttl_adjustment`, and
 * `get_tuning_suggestions`.
 *
 * This module is the **side table** for everything that cannot be derived from
 * the tool definitions: the routing `category`, a one-line `summary`, search
 * `keywords`, and the `core` marker. The human-readable `description` is NOT
 * duplicated here — `search_tools` reads it off the live tool definition at
 * call time, so there is one source per fact.
 *
 * `__tests__/tool-catalog.test.ts` is the anti-drift guard: a tool with no
 * catalog entry, or a catalog entry with no tool, fails the suite. That is what
 * makes the four lists above safe to derive instead of hand-maintained.
 *
 * ## The core set
 *
 * `core: true` marks the tools that answer the most common questions and that
 * bootstrap everything else: the `query` primitive, schema exploration, the
 * two health primitives, the knowledge loaders, the loop control tools, and
 * `search_tools` itself (useless if it is itself discoverable). `CORE_TOOL_NAMES`
 * is the ordered list; `longTailToolNames()` is the complement, for a caller
 * that wants a core-only tool map via the existing `filterTools` seam in
 * `clickhouse-agent.ts`.
 *
 * Note the deliberate limit: the default request still sends the **whole** tool
 * set, because the AI SDK's `ToolLoopAgent` takes a static `tools` map and
 * offers no supported way to inject a tool mid-loop. Subsetting to core would
 * mean the model could discover a long-tail tool and then be unable to call it
 * in the same turn. `search_tools` therefore only ever advertises tools that
 * are actually registered this request, and the operator's `disabledTools` /
 * `coreOnly` seam stays the way to actually narrow the map.
 */

export type ToolCategory =
  | 'schema'
  | 'query'
  | 'health'
  | 'storage'
  | 'replication'
  | 'merges'
  | 'capacity'
  | 'advisor'
  | 'planning'
  | 'knowledge'
  | 'visualization'
  | 'insights'
  | 'reports'
  | 'dashboards'
  | 'control'
  | 'postgres'
  | 'peerdb'
  | 'discovery'

/** One catalog row. `description` is read from the tool, not stored here. */
export interface ToolCatalogEntry {
  /** The tool name, exactly as registered in `createAllTools()`. */
  name: string
  category: ToolCategory
  /** One line, written for the model's routing decision. */
  summary: string
  /** Extra search terms a user would not put in the tool name. */
  keywords: readonly string[]
  /** Always-in-context, bootstrap-capable tools. */
  core: boolean
}

/** Max results `search_tools` returns (the house cap). */
export const TOOL_SEARCH_RESULT_LIMIT = 15

const e = (
  name: string,
  category: ToolCategory,
  summary: string,
  keywords: readonly string[],
  core = false
): ToolCatalogEntry => ({ name, category, summary, keywords, core })

/**
 * The catalog, keyed by tool name. Order is discovery order for `search_tools`
 * with no query, so the core tools lead.
 */
export const TOOL_CATALOG: Readonly<Record<string, ToolCatalogEntry>> = {
  // ── Discovery ──
  search_tools: e(
    'search_tools',
    'discovery',
    'Find agent tools by what you want to do, when you are not sure which tool fits. Returns the matching tool names with when to use each one.',
    [
      'find a tool',
      'which tool',
      'what can you do',
      'capabilities',
      'tool list',
      'how do i',
      'lookup',
      'discover',
    ],
    true
  ),

  // ── Schema & exploration ──
  query: e(
    'query',
    'schema',
    'Run read-only SQL on ClickHouse (SELECT / WITH / DESCRIBE / EXPLAIN). The general escape hatch once a primitive or skill does not cover it.',
    ['sql', 'run sql', 'ad-hoc', 'select', 'raw query'],
    true
  ),
  list_databases: e(
    'list_databases',
    'schema',
    'List every database with engine and comment metadata.',
    ['databases', 'schemas', 'show databases', 'engines'],
    true
  ),
  list_tables: e(
    'list_tables',
    'schema',
    'List the tables in one database with row counts and on-disk size.',
    ['tables', 'show tables', 'row count', 'table size'],
    true
  ),
  get_table_schema: e(
    'get_table_schema',
    'schema',
    'Column definitions, types, and defaults for one table. Call this before hand-writing SQL against system.* tables.',
    ['columns', 'ddl', 'column types', 'schema of table', 'describe'],
    true
  ),
  explore_table_schema: e(
    'explore_table_schema',
    'schema',
    'Three-mode schema exploration: no args lists databases, a database lists its tables, database + table returns the full schema with indexes and keys.',
    ['explore', 'browse', 'navigate schema', 'indexes', 'sorting key'],
    true
  ),

  // ── Query analysis ──
  get_running_queries: e(
    'get_running_queries',
    'query',
    'Queries executing right now, ordered by elapsed time.',
    ['running', 'in flight', 'currently executing', 'long query', 'active queries']
  ),
  get_slow_queries: e(
    'get_slow_queries',
    'query',
    'Slowest completed queries in a time window (default last hour), ranked per execution. Use list_slow_query_patterns instead for "which query shape is expensive overall".',
    ['slow query', 'slowest', 'query log', 'latency', 'took long', 'performance']
  ),
  get_failed_queries: e(
    'get_failed_queries',
    'query',
    'Recent failed queries in a time window (default last 24 hours), with the error text.',
    ['failed', 'errors', 'exceptions', 'query failures', 'query log']
  ),
  list_slow_query_patterns: e(
    'list_slow_query_patterns',
    'query',
    'Normalized slow-query patterns from system.query_log grouped by query hash: calls, duration percentiles, CPU, memory, bytes, cache hit ratio.',
    ['patterns', 'normalized', 'query shapes', 'which query shape', 'aggregate cost', 'grouped']
  ),
  explain_query: e(
    'explain_query',
    'query',
    'EXPLAIN PLAN / PIPELINE / PLAN indexes=1 for a query — the plan, so you can see why it is slow.',
    ['explain', 'plan', 'execution plan', 'why slow', 'indexes used']
  ),
  estimate_query_cost: e(
    'estimate_query_cost',
    'query',
    'Pre-flight cost of a query (rows scanned, bytes read, peak memory, wall time) from EXPLAIN alone, without running it.',
    ['estimate', 'cost', 'how expensive', 'before running', 'dry run', 'predict']
  ),

  // ── Health ──
  get_metrics: e(
    'get_metrics',
    'health',
    'Server health: version, uptime, active connections, memory. The first call on an unfamiliar host.',
    ['health', 'uptime', 'version', 'cpu', 'memory', 'connections', 'server status'],
    true
  ),
  get_disk_usage: e(
    'get_disk_usage',
    'health',
    'Free and total space per disk. First call for any disk-space question.',
    ['disk', 'disk space', 'free space', 'storage full', 'capacity used'],
    true
  ),

  // ── Storage ──
  get_table_parts: e(
    'get_table_parts',
    'storage',
    'Part-level detail for one table: rows, bytes, compression ratio.',
    ['parts', 'compression', 'part size', 'table size detail']
  ),
  estimate_mutation_impact: e(
    'estimate_mutation_impact',
    'storage',
    'Dry-run an ALTER TABLE ... UPDATE/DELETE: rows matched, parts and bytes to rewrite, projected duration, and whether free disk can hold the rewrite.',
    ['mutation', 'alter update', 'alter delete', 'impact', 'rewrite', 'dry run']
  ),

  // ── Replication & merges ──
  get_replication_status: e(
    'get_replication_status',
    'replication',
    'Per-table replication delay, queue size, and replica counts.',
    ['replication', 'replica lag', 'queue', 'replica count', 'follower'],
    true
  ),
  get_merge_status: e(
    'get_merge_status',
    'merges',
    'Merges running right now with progress and elapsed time.',
    ['merge', 'merges', 'background merge', 'compaction']
  ),

  // ── Capacity planning (recommend-only) ──
  forecast_disk_capacity: e(
    'forecast_disk_capacity',
    'capacity',
    'Project when disks run out of free space from recent write growth, plus the top contributing tables.',
    ['forecast', 'when will disk fill', 'capacity planning', 'runway', 'projection']
  ),
  suggest_ttl_adjustment: e(
    'suggest_ttl_adjustment',
    'capacity',
    'Recommend a TTL / retention change that keeps projected disk use at or under 80% without dropping below a stated retention floor.',
    ['ttl', 'retention', 'expire', 'keep longer', 'delete old data']
  ),

  // ── Advisors (recommend-only) ──
  get_optimization_recommendations: e(
    'get_optimization_recommendations',
    'advisor',
    'Ranked skip-index, projection, partition-key, and PREWHERE recommendations for one slow query, with DDL and estimated savings.',
    ['optimize', 'recommendations', 'skip index', 'projection', 'prewhere', 'make faster']
  ),
  get_tuning_suggestions: e(
    'get_tuning_suggestions',
    'advisor',
    'Ranked schema and settings lint for a database or table: needless Nullable, oversized ints, codecs, LowCardinality, TTL/PARTITION BY bloat, risky server settings.',
    ['tuning', 'lint', 'settings', 'nullable', 'lowcardinality', 'codec', 'schema review']
  ),
  recommend_materialized_view: e(
    'recommend_materialized_view',
    'advisor',
    'Mine frequent GROUP BY shapes and design a Summing/AggregatingMergeTree materialized view or projection, with DDL, size estimate, and risk.',
    ['materialized view', 'mv', 'pre-aggregate', 'rollup', 'projection ddl']
  ),

  // ── Planning & interaction ──
  update_plan: e(
    'update_plan',
    'planning',
    'Publish a step-by-step plan for a 3+ step investigation and keep it current. Skip it for one-tool answers.',
    ['plan', 'todo', 'steps', 'checklist', 'track progress', 'multi-step'],
    true
  ),
  ask_user: e(
    'ask_user',
    'planning',
    'Ask the user a question when a request has several valid readings, or when a needed parameter is genuinely ambiguous.',
    ['ask', 'clarify', 'question', 'ambiguous', 'confirm with user'],
    true
  ),

  // ── Knowledge ──
  load_skill: e(
    'load_skill',
    'knowledge',
    'Load one expert skill guide with column-accurate system.* SQL recipes. The step between a primitive and raw SQL.',
    ['skill', 'guide', 'recipe', 'best practices', 'instructions', 'knowledge'],
    true
  ),
  find_reference_query: e(
    'find_reference_query',
    'knowledge',
    'Search the dashboard library of 100+ vetted, version-aware monitoring queries and return the closest matches with their SQL.',
    ['reference query', 'known query', 'template', 'library', 'catalog of queries'],
    true
  ),

  // ── Visualization ──
  query_and_visualize: e(
    'query_and_visualize',
    'visualization',
    'Run a SQL query and return an interactive chart; chart type is auto-detected from the result columns.',
    ['chart', 'graph', 'plot', 'visualize', 'trend chart', 'line chart']
  ),

  // ── Insights & reports ──
  explain_anomaly_score: e(
    'explain_anomaly_score',
    'insights',
    'Explain a per-host/per-metric anomaly baseline (mean, stddev, median, MAD) and score a current value against it.',
    ['anomaly', 'z-score', 'baseline', 'unusual', 'outlier', 'why flagged']
  ),
  generate_cluster_report: e(
    'generate_cluster_report',
    'reports',
    'Deterministic cluster health report over a weekly or monthly window, as structured summary plus markdown to narrate.',
    ['report', 'weekly', 'monthly', 'summary', 'health report', 'digest']
  ),

  // ── Dashboards ──
  suggest_dashboard: e(
    'suggest_dashboard',
    'dashboards',
    'Propose a dashboard layout built only from charts that already exist in the chart registry, for a natural-language request.',
    ['dashboard', 'layout', 'chart layout', 'build a dashboard', 'tiles']
  ),

  // ── Control actions (destructive, env-gated) ──
  kill_query: e(
    'kill_query',
    'control',
    'Cancel a running query by query_id. Destructive.',
    ['kill', 'cancel query', 'terminate query', 'stop query', 'abort']
  ),
  kill_mutation: e(
    'kill_mutation',
    'control',
    'Cancel a running mutation on a table. Destructive.',
    ['cancel mutation', 'kill mutation', 'stop alter', 'abort mutation']
  ),
  optimize_table: e(
    'optimize_table',
    'control',
    'Run OPTIMIZE on a table to force merges. Destructive.',
    ['optimize', 'force merge', 'compact table', 'finalize parts']
  ),

  // ── Cross-source Postgres (env-gated) ──
  run_postgres_select_query: e(
    'run_postgres_select_query',
    'postgres',
    'Run one read-only SQL statement against a Postgres source, to correlate with ClickHouse in the same conversation.',
    ['postgres', 'pg', 'cross-source', 'postgresql query']
  ),
  get_postgres_metrics: e(
    'get_postgres_metrics',
    'postgres',
    'Postgres health for a source: version, uptime, connection saturation, cache hit ratio, transactions, replication.',
    ['postgres health', 'pg stats', 'pg activity', 'connections saturation']
  ),
  list_postgres_slow_query_patterns: e(
    'list_postgres_slow_query_patterns',
    'postgres',
    'Top normalized slow-query patterns on a Postgres source from pg_stat_statements.',
    ['postgres slow', 'pg_stat_statements', 'pg patterns', 'pg slow query']
  ),
  get_postgres_table_stats: e(
    'get_postgres_table_stats',
    'postgres',
    'Per-table Postgres health: worst dead-tuple bloat and unused indexes, with last vacuum/analyze times.',
    ['postgres bloat', 'dead tuples', 'unused index', 'pg vacuum', 'pg table stats']
  ),

  // ── PeerDB (env-gated) ──
  get_peerdb_mirror_status: e(
    'get_peerdb_mirror_status',
    'peerdb',
    'PeerDB mirror state: no arguments for a worst-first fleet overview, or one mirrorName for its rows-synced total, per-table counts, batches, and errors.',
    ['peerdb', 'mirror', 'replication lag', 'which mirrors failing', 'cdc status']
  ),
  get_peerdb_metrics: e(
    'get_peerdb_metrics',
    'peerdb',
    'PeerDB pipeline metrics by `metric`: replication-slot lag and its history, CDC rows-synced throughput, snapshot progress, per-peer queries, fleet aggregates.',
    [
      'peerdb',
      'replication slot',
      'slot lag',
      'cdc throughput',
      'rows synced',
      'snapshot progress',
      'initial load',
      'fleet',
    ]
  ),
} as const

/**
 * Look up a catalog row. Returns `undefined` for an unregistered name —
 * `__tests__/tool-catalog.test.ts` turns that into a failing test.
 */
export function getToolCatalogEntry(
  name: string
): ToolCatalogEntry | undefined {
  return TOOL_CATALOG[name]
}

/** Every cataloged tool name, in catalog order. */
export function catalogToolNames(): string[] {
  return Object.keys(TOOL_CATALOG)
}

/** The core set, in catalog order. */
export function coreToolNames(): string[] {
  return catalogToolNames().filter((n) => TOOL_CATALOG[n]?.core)
}

/** The non-core (discoverable) set, in catalog order. */
export function longTailToolNames(): string[] {
  return catalogToolNames().filter((n) => !TOOL_CATALOG[n]?.core)
}

/** Every distinct category present in the catalog, sorted for stable output. */
export function toolCategories(): ToolCategory[] {
  return [...new Set(catalogToolNames().map((n) => TOOL_CATALOG[n].category))].sort()
}
