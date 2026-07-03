/**
 * Canned `system.*` / `query_log` rows for the agent golden-scenario suite
 * (`../scenarios.test.ts`). Each export mirrors the row shape a real tool's
 * SQL would produce (see `src/lib/ai/agent/tools/*.ts`) so a mocked
 * `fetchData` can return realistic data per scenario without a live
 * ClickHouse instance.
 */

/** `get_slow_queries` — system.query_log, type = 'QueryFinish' */
export const SLOW_QUERY_ROWS = [
  {
    query_id: 'q-slow-1',
    user: 'analyst',
    query_duration_ms: 42000,
    read_rows: 950000000,
    memory_usage: 2147483648,
    query:
      "SELECT customer_id, sum(amount) FROM sales.orders WHERE order_date >= '2026-01-01' GROUP BY customer_id",
    event_time: '2026-07-01 10:00:00',
  },
]

/** `explain_query` — EXPLAIN PLAN/PIPELINE/indexes output */
export const EXPLAIN_ROWS = [
  { explain: 'Expression ((Projection + Before ORDER BY))' },
  { explain: '  Aggregating' },
  { explain: '    Expression (Before GROUP BY)' },
  { explain: '      ReadFromMergeTree (sales.orders)' },
  { explain: '        Description: Full scan, no index used, no PREWHERE' },
]

/** `get_table_parts` — system.parts, a fragmented table (many small parts) */
export const FRAGMENTED_PARTS_ROWS = Array.from({ length: 6 }, (_, i) => ({
  name: `all_${i + 1}_${i + 1}_0`,
  partition: '202607',
  rows: 12000,
  size_on_disk: '2.10 MiB',
  uncompressed_size: '6.40 MiB',
  compression_ratio: 0.328,
  modification_time: `2026-07-0${i + 1} 03:00:00`,
  level: 0,
}))

/** `get_disk_usage` — system.disks, critically low free space */
export const DISK_USAGE_CRITICAL_ROWS = [
  {
    name: 'default',
    path: '/var/lib/clickhouse/',
    free: '12.00 GiB',
    total: '500.00 GiB',
    free_pct: 2.4,
  },
]

/** `get_replication_status` — system.replicas, one table lagging */
export const REPLICATION_LAG_ROWS = [
  {
    database: 'sales',
    table: 'orders_replicated',
    is_leader: 0,
    is_readonly: 0,
    absolute_delay: 3600,
    queue_size: 128,
    inserts_in_queue: 100,
    merges_in_queue: 28,
    log_pointer: 5000,
    total_replicas: 3,
    active_replicas: 2,
  },
]

/** `get_failed_queries` — system.query_log, type = 'ExceptionWhileProcessing' */
export const FAILED_QUERY_ROWS = [
  {
    query_id: 'f-1',
    user: 'etl',
    exception_code: 60,
    error: "Table sales.orders_v2 doesn't exist",
    query_duration_ms: 12,
    event_time: '2026-07-02 08:00:00',
    query: 'SELECT * FROM sales.orders_v2',
  },
  {
    query_id: 'f-2',
    user: 'etl',
    exception_code: 60,
    error: "Table sales.orders_v2 doesn't exist",
    query_duration_ms: 9,
    event_time: '2026-07-02 08:05:00',
    query: 'SELECT count() FROM sales.orders_v2',
  },
]

/** `get_running_queries` — system.processes, one long-running query */
export const RUNNING_QUERY_ROWS = [
  {
    query_id: 'r-1',
    user: 'batch',
    elapsed: 5400,
    read_rows: 8000000000,
    memory_usage: 17179869184,
    query:
      'SELECT * FROM sales.orders o JOIN sales.customers c ON o.customer_id = c.id',
  },
]

/** `get_merge_status` — system.merges, a slow-progressing merge */
export const MERGE_STATUS_ROWS = [
  {
    database: 'sales',
    table: 'orders',
    progress_pct: 12.5,
    size: '80.00 GiB',
    elapsed: 7200,
  },
]

/** `list_tables` — system.tables for database "sales" */
export const TABLES_ROWS = [
  {
    name: 'orders',
    engine: 'ReplicatedMergeTree',
    total_rows: 500000000,
    size: '120.00 GiB',
  },
  {
    name: 'customers',
    engine: 'ReplicatedMergeTree',
    total_rows: 2000000,
    size: '1.20 GiB',
  },
]

/** `get_metrics` — version() / uptime() / system.metrics (three sub-queries) */
export const METRICS_VERSION_ROWS = [{ version: '24.8.4.13' }]
export const METRICS_UPTIME_ROWS = [{ uptime_seconds: 864000 }]
export const METRICS_ROWS = [
  { metric: 'TCPConnection', value: 42 },
  { metric: 'HTTPConnection', value: 10 },
  { metric: 'MemoryTracking', value: 8589934592 },
]

/** `query_and_visualize` — hourly query-volume time series */
export const QUERY_VOLUME_ROWS = [
  { hour: '2026-07-02 00:00:00', queries: 1200 },
  { hour: '2026-07-02 01:00:00', queries: 900 },
  { hour: '2026-07-02 02:00:00', queries: 750 },
]
