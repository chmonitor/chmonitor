export interface McpToolParam {
  name: string
  type: string
  required: boolean
  default?: string | number
  description: string
}

export type McpToolCategory = 'schema' | 'query' | 'system'

export interface McpTool {
  name: string
  description: string
  category: McpToolCategory
  params: McpToolParam[]
  exampleResponse: string
}

export interface McpResource {
  name: string
  uri: string
  description: string
}

export interface McpServerInfo {
  name: string
  version: string
  description: string
  tools: McpTool[]
  resources: McpResource[]
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'query',
    description: 'Execute a read-only SQL query against ClickHouse',
    category: 'query',
    params: [
      {
        name: 'sql',
        type: 'string',
        required: true,
        description: 'The SQL query to execute (SELECT statements only)',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host to query (default: 0)',
      },
    ],
    exampleResponse: `[
  { "database": "default", "name": "events", "total_rows": 1234567 },
  { "database": "analytics", "name": "sessions", "total_rows": 987654 }
]`,
  },
  {
    name: 'list_databases',
    description: 'List all databases with their engines and comments',
    category: 'schema',
    params: [
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `[
  { "name": "default", "engine": "Atomic", "comment": "" },
  { "name": "analytics", "engine": "Atomic", "comment": "Analytics data" },
  { "name": "system", "engine": "Memory", "comment": "" }
]`,
  },
  {
    name: 'list_tables',
    description: 'List tables in a database with row counts and sizes',
    category: 'schema',
    params: [
      {
        name: 'database',
        type: 'string',
        required: true,
        description: 'Database name to list tables from',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `[
  {
    "name": "events",
    "engine": "MergeTree",
    "total_rows": 1234567,
    "total_bytes": 52428800,
    "comment": "User events"
  }
]`,
  },
  {
    name: 'get_table_schema',
    description:
      'Get column definitions for a table including types, defaults, and comments',
    category: 'schema',
    params: [
      {
        name: 'database',
        type: 'string',
        required: true,
        description: 'Database name',
      },
      {
        name: 'table',
        type: 'string',
        required: true,
        description: 'Table name',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `[
  {
    "name": "id",
    "type": "UInt64",
    "default_kind": "",
    "default_expression": "",
    "comment": "Primary key"
  },
  {
    "name": "created_at",
    "type": "DateTime",
    "default_kind": "DEFAULT",
    "default_expression": "now()",
    "comment": ""
  }
]`,
  },
  {
    name: 'get_metrics',
    description:
      'Get key ClickHouse server metrics: version, uptime, connections, and memory',
    category: 'system',
    params: [
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `{
  "version": "24.3.1",
  "uptime_seconds": 864000,
  "connections": 42,
  "memory_usage_bytes": 8589934592,
  "queries_in_flight": 3
}`,
  },
  {
    name: 'get_running_queries',
    description: 'List currently running queries ordered by elapsed time',
    category: 'system',
    params: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: 50,
        description: 'Max number of queries to return (default: 50)',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `[
  {
    "query_id": "abc123",
    "user": "default",
    "elapsed": 12.5,
    "query": "SELECT count() FROM events WHERE ...",
    "memory_usage": 134217728,
    "read_rows": 5000000
  }
]`,
  },
  {
    name: 'get_slow_queries',
    description: 'Get the slowest completed queries from the query log',
    category: 'system',
    params: [
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: 10,
        description: 'Number of slow queries to return (default: 10)',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `[
  {
    "query_id": "xyz789",
    "user": "analyst",
    "query_duration_ms": 45000,
    "read_rows": 100000000,
    "memory_usage": 2147483648,
    "query": "SELECT ... FROM large_table GROUP BY ..."
  }
]`,
  },
  {
    name: 'get_merge_status',
    description:
      'Get currently running merge operations with progress and elapsed time',
    category: 'system',
    params: [
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `[
  {
    "database": "default",
    "table": "events",
    "elapsed": 30.2,
    "progress": 0.75,
    "num_parts": 8,
    "result_part_name": "20240101_1_8_1",
    "memory_usage": 524288000
  }
]`,
  },
  {
    name: 'explore_table_schema',
    description:
      'Comprehensive schema exploration with relationship discovery. Three modes: no params (list databases), database only (summarize tables), database+table (full schema with relationships)',
    category: 'schema',
    params: [
      {
        name: 'database',
        type: 'string',
        required: false,
        description:
          'Database name (optional - if omitted, lists all databases)',
      },
      {
        name: 'table',
        type: 'string',
        required: false,
        description:
          'Table name (requires database. If provided, returns full schema with relationships)',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `// Mode 1: No params
[{ "name": "default", "engine": "Atomic", "comment": "" }]

// Mode 2: Database only
[{ "name": "events", "engine": "MergeTree", "partition_key": "toYYYYMM(event_time)", "sorting_key": "(user_id, event_time)", "total_rows": 1234567 }]

// Mode 3: Database + table
{
  "table": { "database": "analytics", "name": "events", "engine": "MergeTree", "partition_key": "toYYYYMM(event_time)", "sorting_key": "(user_id, event_time)", "primary_key": "(user_id, event_time)", "total_rows": 1234567 },
  "columns": [
    { "name": "user_id", "type": "UInt64", "is_in_primary_key": true, "is_in_sorting_key": true, "is_in_partition_key": false },
    { "name": "event_time", "type": "DateTime", "is_in_primary_key": true, "is_in_sorting_key": true, "is_in_partition_key": false }
  ],
  "upstream_dependencies": [{ "dep_database": "raw", "dep_table": "events_staging", "engine": "MergeTree" }],
  "downstream_dependencies": [{ "dependent_database": "analytics", "dependent_table": "events_summary", "engine": "AggregatingMergeTree" }],
  "potential_foreign_keys": [{ "column": "user_id", "potential_table": "users" }]
}`,
  },
  {
    name: 'analyze_performance',
    description:
      'Get a structured performance analysis snapshot with severity ratings. Returns slow queries, high part counts, merge backlog, memory pressure, and disk utilization in one call',
    category: 'system',
    params: [
      {
        name: 'lastHours',
        type: 'number',
        required: false,
        default: 1,
        description: 'Time window for analysis in hours (default: 1)',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `{
  "slow_queries": {
    "data": [{ "query_id": "abc123", "query_duration_ms": 45000, "query_preview": "SELECT ..." }],
    "severity": "WARNING"
  },
  "high_part_counts": { "data": [{ "database": "default", "table": "events", "part_count": 312 }], "severity": "OK" },
  "merge_backlog": { "data": [], "severity": "OK" },
  "memory_pressure": { "data": [{ "metric": "MemoryTracking", "value": 8589934592 }], "severity": "OK" },
  "disk_utilization": { "data": [{ "name": "default", "free_percent": 62.5 }], "severity": "OK" }
}`,
  },
  {
    name: 'get_optimization_recommendations',
    description:
      'Analyze a slow query (by queryId from system.query_log, or raw sql) and return ranked optimization recommendations — skip-index, projection, partition key, or a PREWHERE rewrite — each with DDL/rewrite text, rationale, risk, effort, and estimated savings. Read-only and recommend-only',
    category: 'query',
    params: [
      {
        name: 'sql',
        type: 'string',
        required: false,
        description: 'Raw SQL to analyze. Provide this or queryId',
      },
      {
        name: 'queryId',
        type: 'string',
        required: false,
        description:
          'A query_id from system.query_log to resolve and analyze. Provide this or sql',
      },
      {
        name: 'database',
        type: 'string',
        required: false,
        description:
          'Default database for unqualified table references (default: "default")',
      },
      {
        name: 'hostId',
        type: 'number',
        required: false,
        default: 0,
        description: 'Index of the ClickHouse host (default: 0)',
      },
    ],
    exampleResponse: `{
  "ok": true,
  "recommendations": [
    {
      "kind": "skip_index",
      "ddl": "ALTER TABLE analytics.events ADD INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 4",
      "rationale": "WHERE filters on user_id but it is not in the sorting key",
      "risk": "low",
      "effort": "low",
      "summary": "Estimated upper bound: up to ~12,000 granules currently read could be avoided"
    }
  ]
}`,
  },
]

export const EXAMPLE_PROMPTS = [
  {
    category: 'Schema & Discovery',
    prompts: [
      'List all databases and show me their sizes',
      'Show me the schema of the events table in the analytics database',
      'How many tables are in the default database?',
      'Find all tables with more than 1 billion rows',
    ],
  },
  {
    category: 'Performance & Queries',
    prompts: [
      'Show me the slowest queries in the last hour',
      'Are there any queries running for more than 60 seconds?',
      'What queries are consuming the most memory right now?',
      'Find the top 5 most expensive queries by CPU time',
    ],
  },
  {
    category: 'Replication & Merges',
    prompts: [
      'Check if any replicas are lagging',
      'Are there any merge operations stuck or taking too long?',
      'Show me the replication queue status',
      'Which tables have the most pending merges?',
    ],
  },
  {
    category: 'System Health',
    prompts: [
      "What's the current memory usage of the ClickHouse server?",
      'How many connections are currently active?',
      'Show me the server uptime and version',
      'Are there any errors in the recent logs?',
    ],
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

export interface McpToolCategoryInfo {
  readonly name: string
  readonly icon: string
  readonly description: string
}

export const MCP_TOOL_CATEGORIES: Readonly<
  Record<McpToolCategory, McpToolCategoryInfo>
> = {
  schema: {
    name: 'Schema',
    icon: '📊',
    description: 'Explore database structure and table schemas',
  },
  query: {
    name: 'Query',
    icon: '🔍',
    description: 'Execute custom SQL queries',
  },
  system: {
    name: 'System',
    icon: '⚙️',
    description: 'Monitor server health and performance',
  },
}

/**
 * Get tool metadata by name
 */
export function getToolMetadata(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name)
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: McpToolCategory): McpTool[] {
  return MCP_TOOLS.filter((tool) => tool.category === category)
}
