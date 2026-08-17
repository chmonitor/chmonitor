---
name: system-tables-reference
description: "Exact column names for the system tables the agent queries most (processes, query_log, parts, merges, mutations, replicas, replication_queue, disks, settings, zookeeper, users/grants, metrics) plus rules for choosing dedicated tools over raw SQL. Load before hand-writing SQL against system tables."
---

# System Tables Reference

Load this skill before writing raw SQL against `system.*` tables. It lists the
columns that actually exist so you don't reference hallucinated columns. When a
dedicated tool exists for what you need, call it instead of writing SQL.

## Prefer Dedicated Tools Over Raw SQL

Many questions map to a purpose-built tool. Use it — the SQL is already correct
and version-aware:

| Question | Use this tool, not raw SQL |
|----------|----------------------------|
| What is running now? | `get_running_queries` |
| Slowest finished queries? | `get_slow_queries` |
| Recent failures/errors? | `get_failed_queries` |
| Heaviest queries by memory/bytes/duration? | `list_slow_query_patterns` / `get_slow_queries` |
| Active merges? | `get_merge_status` |
| Replication health? | `get_replication_status` |
| Disk space? | `get_disk_usage` |
| Server version/uptime/connections? | `get_metrics` |

Only fall back to the `query` tool for ad-hoc questions that no dedicated tool
covers. If a dedicated tool returns an error, fix the call (e.g. `hostId` is a
number like `0`, not a string), do **not** rewrite it as raw SQL.

## system.processes — currently running queries

There is **no `database` column** on `system.processes`. Selecting it fails with
"Unknown expression identifier `database`".

Available columns:
`query_id`, `user`, `query`, `elapsed`, `read_rows`, `read_bytes`,
`written_rows`, `written_bytes`, `total_rows_approx`, `memory_usage`,
`peak_memory_usage`, `query_kind`, `is_initial_query`, `address`, `port`,
`initial_user`, `initial_query_id`, `client_name`, `thread_ids`, `ProfileEvents`,
`Settings`, `current_database`.

- Use `current_database` (not `database`) for the session's database.
- To exclude the monitoring query itself: `WHERE query NOT LIKE '%processes%'`.
  Do not invent syntax like `WHERE is_query SELECT WITHOUT '...'`.
- `elapsed` is seconds (Float64). Display with `formatReadableTimeDelta(elapsed)`.

```sql
SELECT query_id, user, current_database, elapsed, read_rows, memory_usage,
       substring(query, 1, 200) AS query
FROM system.processes
WHERE query NOT LIKE '%processes%'
ORDER BY elapsed DESC
```

## system.query_log — query history

Filter by `type` and time. Each query produces a `QueryStart` row and a finish
row (`QueryFinish` on success, `ExceptionWhileProcessing` on error). For
completed queries always filter `WHERE type = 'QueryFinish'`, otherwise you
double-count starts.

Key columns: `query_id`, `type`, `event_time`, `event_date`, `query_start_time`,
`query_duration_ms`, `read_rows`, `read_bytes`, `result_rows`, `memory_usage`,
`user`, `query`, `exception_code`, `exception`, `normalized_query_hash`,
`is_initial_query`, `databases`, `tables`, `columns`, `ProfileEvents`.

- The per-row database/table lists are `databases`/`tables`/`columns` (Array),
  not `database`/`table`.
- Add `AND is_initial_query = 1` to avoid counting internal sub-queries.

## system.parts — table parts

Has `database` and `table`. Filter `WHERE active = 1` for live parts.
Key columns: `database`, `table`, `partition`, `name`, `active`, `rows`,
`bytes_on_disk`, `data_compressed_bytes`, `data_uncompressed_bytes`,
`marks`, `modification_time`, `min_time`, `max_time`, `part_type`, `disk_name`.

Compression ratio: `data_uncompressed_bytes / data_compressed_bytes`.

## system.merges — active merges

Columns: `database`, `table`, `elapsed`, `progress` (0..1), `num_parts`,
`source_part_names`, `result_part_name`, `total_size_bytes_compressed`,
`rows_read`, `rows_written`, `memory_usage`, `is_mutation`, `merge_type`.

## system.replicas — replication status

One row per replicated table. Columns: `database`, `table`, `is_leader`,
`is_readonly`, `absolute_delay`, `queue_size`, `inserts_in_queue`,
`merges_in_queue`, `total_replicas`, `active_replicas`, `last_queue_update`,
`zookeeper_path`. Healthy = `absolute_delay = 0`, `is_readonly = 0`,
`active_replicas = total_replicas`.

## system.metrics vs system.events vs system.asynchronous_metrics

These three are easy to confuse — they use different column names:

- `system.metrics`: instantaneous gauges. Columns `metric`, `value`,
  `description`. e.g. `Query`, `TCPConnection`, `MemoryTracking`.
- `system.events`: cumulative counters. Columns `event`, `value`,
  `description` — the name column is `event`, **not** `metric`.
- `system.asynchronous_metrics`: periodically sampled. Columns `metric`,
  `value`. e.g. `Uptime`, `jemalloc.*`, disk/CPU samples.

## system.errors — error counters

Columns: `name`, `code`, `value`, `last_error_time`, `last_error_message`,
`last_error_trace`. There is no `last_update_time` column.

## system.mutations — ALTER UPDATE/DELETE progress

One row per mutation. Columns: `database`, `table`, `mutation_id`, `command`,
`create_time`, `parts_to_do`, `parts_to_do_names`, `is_done`,
`latest_failed_part`, `latest_fail_time`, `latest_fail_reason`.

- Stuck mutation = `is_done = 0` with a non-empty `latest_fail_reason`.
- Use `query` on `system.mutations`. `parts_to_do > 0` means still running.

## system.replication_queue — pending replication tasks

Columns: `database`, `table`, `type`, `create_time`, `num_tries`,
`last_exception`, `last_attempt_time`, `num_postponed`, `postpone_reason`,
`node_name`, `is_currently_executing`. High `num_tries` + `last_exception`
signals a stuck entry. Prefer `get_replication_status`, then `query` `system.replication_queue`.

## system.disks — storage devices

Columns: `name`, `path`, `free_space`, `total_space`, `unreserved_space`,
`keep_free_space`, `type`. Used % = `(total_space - free_space) / total_space`.
Prefer the `get_disk_usage` tool.

## system.detached_parts — parts needing attention

Columns: `database`, `table`, `partition_id`, `name`, `disk`, `reason`,
`bytes_on_disk`. A non-null `reason` (e.g. `broken`, `unexpected`) flags parts
that won't be merged. Query `system.detached_parts` with `query` (no dedicated tool).

## system.settings vs system.merge_tree_settings — configuration

- `system.settings`: session/server settings. Columns `name`, `value`,
  `changed`, `default`, `description`, `type`, `readonly`. Filter `changed = 1`
  for non-default values. Query `system.settings` with `query` (no dedicated tool).
- `system.merge_tree_settings`: MergeTree engine settings, same columns. Query
  `system.merge_tree_settings` with `query`.

## system.zookeeper / Keeper — coordination

`system.zookeeper` is an **optional** table that only exists when ZooKeeper or
ClickHouse Keeper is configured. Querying it **requires a `path` filter**, e.g.
`SELECT name, value, ctime, mtime FROM system.zookeeper WHERE path = '/'`.
Without `WHERE path = ...` it errors. Query `system.zookeeper` with a `path` filter. If
the query fails with "Unknown table", Keeper is not configured.

## Users, roles & grants — access control

- `system.users`: `name`, `id`, `storage`, `auth_type`, `host_ip`,
  `host_names`, `default_roles_all`, `default_roles_list`.
- `system.roles`: `name`, `id`, `storage`.
- `system.grants`: `user_name`, `role_name`, `access_type`, `database`,
  `table`, `column`, `is_partial_revoke`, `grant_option`.
- `system.role_grants`: `user_name`, `role_name`, `granted_role_name`.
- `currentUser()` returns the connected user; `system.session_log` (optional)
  has login history. Query `system.users` / `system.grants` / `system.session_log`
  after `get_table_schema`.

## system.metric_log & system.asynchronous_metric_log — historical metrics

Time-series snapshots of `system.metrics` / `system.asynchronous_metrics`.
Columns: `event_time`, `event_date`, plus one column per metric (wide table) in
`metric_log`; `metric`, `value` in `asynchronous_metric_log`. Use for trends
over time rather than instantaneous values.

## system.distributed_ddl_queue — ON CLUSTER operations

Columns: `entry`, `host_name`, `query`, `status`, `cluster`, `initiator`,
`query_create_time`, `query_finish_time`, `exception_code`. `status = 'Failed'`
or a non-zero `exception_code` flags a failed distributed DDL. Query
`system.distributed_ddl_queue` with `query`.

## Recovery Rules

- Unknown column (code 47) or unknown identifier → load this skill or call
  `get_table_schema` for the table, then retry with real column names. Do not
  guess again.
- There is no CPU% column anywhere. Approximate load via `memory_usage`,
  `read_rows`, `read_bytes` on `system.processes`, or `ProfileEvents` such as
  `OSCPUVirtualTimeMicroseconds` in `system.query_log`.

## Cross-references
- Load `query-optimization` for EXPLAIN, PREWHERE, JOIN tuning.
- Load `troubleshooting` for error-code-driven diagnosis.
