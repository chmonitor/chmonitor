---
name: data-analysis
description: "Analyze cluster data and metrics using raw SQL recipes against system.query_log and system.parts when no dedicated tool exists."
---

# Data Analysis

Use this skill when dedicated tools (`get_slow_queries`, `list_slow_query_patterns`,
etc.) don't cover the specific aggregation you need. All recipes below are
**read-only**. Always verify column names against `system-tables-reference` before
running — `system.query_log` columns vary across ClickHouse versions.

Core filter for finished queries:
```sql
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 24 HOUR
  AND is_initial_query = 1
```
Omit `is_initial_query = 1` only when you want internal sub-queries too.

---

## Largest Data Scan Ever

Returns the single query that read the most bytes from disk. Useful for
spotting runaway full-table scans in history.

```sql
SELECT
    query_id,
    user,
    event_time,
    formatReadableSize(read_bytes)  AS read_size,
    formatReadableQuantity(read_rows) AS read_rows_fmt,
    query_duration_ms,
    substring(query, 1, 400)        AS query_text
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
ORDER BY read_bytes DESC
LIMIT 1
```

For the largest scan **in a time window** add `AND event_time >= now() - INTERVAL 7 DAY`.
`read_bytes` is the compressed bytes read from storage; `read_rows` is the row
count before filtering. Column availability: both present since v21.x.

---

## Most Expensive Queries

Rank finished queries by memory, bytes read, or wall-clock duration. Run one
variant or UNION all three for a combined view.

```sql
-- By memory_usage
SELECT
    query_id,
    user,
    event_time,
    query_duration_ms,
    formatReadableSize(memory_usage)  AS memory,
    formatReadableSize(read_bytes)    AS read_size,
    substring(query, 1, 300)          AS query_text
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 24 HOUR
ORDER BY memory_usage DESC
LIMIT 20
```

Swap `ORDER BY memory_usage DESC` for `read_bytes DESC` or
`query_duration_ms DESC` to rank by a different cost axis. The
`list_slow_query_patterns` / `get_slow_queries` cover the common case; use raw SQL when you need
a custom time window or additional columns like `tables` or `ProfileEvents`.

---

## Query Fingerprint Patterns

Groups parameterized variants of the same logical query using
`normalized_query_hash`. Shows which query shapes dominate load.

```sql
SELECT
    normalized_query_hash,
    count()                                          AS calls,
    avg(query_duration_ms)                           AS avg_duration_ms,
    quantile(0.95)(query_duration_ms)                AS p95_duration_ms,
    sum(read_bytes)                                  AS total_read_bytes,
    formatReadableSize(sum(read_bytes))              AS total_read_size,
    formatReadableQuantity(sum(read_rows))           AS total_read_rows,
    any(substring(query, 1, 200))                    AS sample_query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 24 HOUR
GROUP BY normalized_query_hash
ORDER BY total_read_bytes DESC
LIMIT 30
```

`normalized_query_hash` replaces literals with `?` placeholders before hashing
so `SELECT 1` and `SELECT 2` share a hash. Available since v20.6.
`quantile(0.95)` requires no extra setup; use `quantiles(0.5, 0.95, 0.99)` for
multiple percentiles in one pass.

---

## Query Volume / Activity Over Time

Counts of finished queries bucketed by hour. Useful for spotting traffic spikes
or quiet periods.

```sql
SELECT
    toStartOfHour(event_time)                AS hour,
    count()                                  AS queries,
    countIf(exception_code != 0)             AS errors,
    avg(query_duration_ms)                   AS avg_duration_ms,
    formatReadableSize(sum(read_bytes))      AS total_read
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 48 HOUR
GROUP BY hour
ORDER BY hour
```

Swap `toStartOfHour` for `toStartOfFifteenMinutes` or `toStartOfDay` to change
granularity. `exception_code` is 0 on success; a non-zero value with
`type = 'QueryFinish'` means the query completed but reported an error.

---

## Top Tables by Size and Rows

Aggregates `system.parts` (active parts only) to rank user tables by compressed
disk usage and row count.

```sql
SELECT
    database,
    table,
    formatReadableSize(sum(bytes_on_disk))          AS disk_size,
    formatReadableSize(sum(data_compressed_bytes))  AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed,
    round(sum(data_uncompressed_bytes) /
          nullIf(sum(data_compressed_bytes), 0), 2) AS compression_ratio,
    formatReadableQuantity(sum(rows))               AS rows,
    count()                                         AS parts
FROM system.parts
WHERE active = 1
  AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 30
```

`bytes_on_disk` includes index files and marks; `data_compressed_bytes` covers
only column data. Filter `active = 1` to exclude detached/obsolete parts.
All columns present since v21.x. The `get_disk_usage` tool covers per-disk
summaries; this recipe breaks down by table.

---

## Period-over-Period Comparison

Compares query load between two equal-length windows using conditional
aggregation — no subqueries, single scan.

```sql
-- Compare last 24h vs previous 24h
SELECT
    normalized_query_hash,
    any(substring(query, 1, 200))                    AS sample_query,

    -- Current window
    countIf(event_time >= now() - INTERVAL 24 HOUR)             AS calls_now,
    avgIf(query_duration_ms, event_time >= now() - INTERVAL 24 HOUR) AS avg_ms_now,
    formatReadableSize(
        sumIf(read_bytes, event_time >= now() - INTERVAL 24 HOUR)
    )                                                            AS read_now,

    -- Previous window
    countIf(event_time < now() - INTERVAL 24 HOUR)              AS calls_prev,
    avgIf(query_duration_ms, event_time < now() - INTERVAL 24 HOUR) AS avg_ms_prev,
    formatReadableSize(
        sumIf(read_bytes, event_time < now() - INTERVAL 24 HOUR)
    )                                                            AS read_prev,

    -- Delta
    round(
        (countIf(event_time >= now() - INTERVAL 24 HOUR) -
         countIf(event_time  < now() - INTERVAL 24 HOUR)) * 100.0 /
        nullIf(countIf(event_time < now() - INTERVAL 24 HOUR), 0),
    1)                                                           AS call_delta_pct
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 48 HOUR
GROUP BY normalized_query_hash
HAVING calls_now > 5 OR calls_prev > 5
ORDER BY abs(call_delta_pct) DESC NULLS LAST
LIMIT 30
```

The single `WHERE event_time >= now() - INTERVAL 48 HOUR` covers both windows.
`*If` aggregates split the data by condition. Adjust the `INTERVAL` literals
consistently for wider windows (e.g. `7 DAY` / `14 DAY`).

---

## Usage Notes

- `query_log` is sampled on busy clusters; if `log_queries_probability < 1` is
  set, counts will be proportional estimates, not exact totals.
- Column availability varies across versions. If a column reference fails with
  code 47 ("Unknown column"), load `system-tables-reference` and check the real
  schema with `get_table_schema('system.query_log')`.
- `memory_usage` in `query_log` reflects peak memory during the query, not
  average. For CPU approximation use
  `ProfileEvents['OSCPUVirtualTimeMicroseconds']`.
- `system.query_log` is flushed asynchronously; the most recent ~1–2 seconds of
  finished queries may not appear immediately.

## Cross-references

- Load `system-tables-reference` for exact column lists and common pitfalls
  before hand-writing SQL.
- Load `query-optimization` for EXPLAIN-driven tuning once expensive patterns
  are identified.
- Load `troubleshooting` for error-code-driven diagnosis of failed queries
  (`type = 'ExceptionWhileProcessing'`).
