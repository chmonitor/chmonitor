---
name: query-optimization
description: "Advanced query tuning: join algorithms, skip index selection, EXPLAIN interpretation, ProfileEvents profiling, and optimizer settings. Also the autonomous diagnose-loop for open-ended questions like why is my database slow?"
---

# Query Optimization

## Autonomous Diagnose Loop ("why is my database slow?")

Use this loop when the question is open-ended — no specific query was named —
and the agent must find what's slow on its own, not just tune a query the user
already pasted (for that, load `query-tuning-advisor` instead).

**Recommend-only, same as `advisor-tools` and `control-tools`: this loop never
executes DDL, never rewrites a query in place, and never runs an optimize/kill
action on its own. Every step below only reads system tables; the final output
is DDL/rewrite text for the user to review and run themselves.**

1. **List slow patterns** — call `list_slow_query_patterns` (not
   `get_slow_queries`, which returns individual runs, not grouped patterns).
   Defaults to the last 24h, ranked by total duration. Identify the top 1-3
   patterns by `total_duration` (overall cost) and separately note any pattern
   with a high `p99_duration` relative to `p50_duration` (tail-latency outlier)
   or a nonzero `errors` count.
2. **EXPLAIN the worst pattern** — take `normalized_query` from step 1 and call
   `explain_query` with `type: 'indexes'` first (are granules being pruned?),
   then `type: 'plan'` if the indexes output doesn't explain the cost (e.g. a
   large JOIN build side or heavy aggregation step). See "EXPLAIN Analysis"
   below for what to look for.
3. **Get ranked recommendations** — call `get_optimization_recommendations`
   with the same query (`sql` or a `queryId` from `system.query_log`) to get
   ranked skip-index / projection / partition-key / PREWHERE suggestions with
   DDL text, rationale, risk, and effort.
4. **Propose, don't apply** — present the top 1-2 recommendations with their
   DDL/rewrite text, expected impact, and risk. If a pattern also looks like a
   good materialized-view/projection candidate (same GROUP BY shape recurring
   often — see `calls` in step 1), also call `recommend_materialized_view` and
   present that as an alternative. Explicitly tell the user these are
   recommendations to review and run themselves — mirror the control-tools
   confirmation posture, just for read-only advice instead of a destructive
   action.
5. Repeat for the next pattern only if the user wants more than one addressed,
   or if step 1 flagged both a total-duration offender and a separate
   tail-latency/error offender.

## JOIN Strategies
- `join_algorithm` setting: `hash` (default, in-memory), `partial_merge` (spills to disk for large right table), `auto` (lets ClickHouse decide)
- `JOIN ... USING` avoids repeated column names vs `ON` for same-name columns
- Filter both sides before joining to reduce intermediate data
- `GLOBAL JOIN` broadcasts the right table to all shards for distributed queries

## EXPLAIN Analysis
- `EXPLAIN PLAN` — logical plan, shows projection/pushdown transformations
- `EXPLAIN PIPELINE` — physical execution with parallelism info and port counts
- `EXPLAIN INDEXES` — which indexes fire, granules selected vs total
- Look for: full table scans, missing index usage, excessive granule reads

## Index Usage
- Skip index types with use-cases:
  - `minmax` — range queries on numeric/date columns
  - `set(N)` — equality on low-cardinality columns, stores N unique values per granule
  - `bloom_filter` — equality on high-cardinality strings
  - `tokenbf_v1` — tokenized text search (logs, URLs)
- Check effectiveness via `ProfileEvents['SelectedRows']` vs result size

## Query Profiling
- `ProfileEvents` map counters: `SelectedRows`, `MergedRows`, `FileOpen`, `SeekCount`
- `normalized_query_hash` to group parameterized query variants
- `system.query_log` columns: `query_duration_ms`, `memory_usage`, `read_bytes`

## Optimizer Settings
- `enable_optimizer = 1` — activates ClickHouse's new cost-based query optimizer (v22.6+)
- `max_threads` — controls query parallelism; higher = faster but more memory; lower for concurrent workloads
- `prefer_localhost_replica = 1` — avoids network round-trip by reading from local replica on distributed queries
- `system.query_plan` (v23.6+) — persisted query plans for analysis across runs
