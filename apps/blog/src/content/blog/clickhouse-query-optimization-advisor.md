---
title: "The query advisor: DDL recommendations you review, not that run themselves"
description: "How chmonitor's optimization advisor turns a slow ClickHouse query into ranked skip-index, projection, and PREWHERE recommendations — and why it never applies any of them for you."
date: 2026-07-10
tag: How-to
---

This is for anyone who's found a slow query in `system.query_log` and then had to guess whether a skip index, a projection, or a PREWHERE rewrite would actually fix it. chmonitor's query advisor answers that question with ranked, explained recommendations — but it stops at the recommendation. By the end you'll know how to run it and what you're expected to do with the output.

## Prerequisites

- A chmonitor instance connected to a ClickHouse host with a query worth investigating.
- The AI agent configured (see [AI agent quick start](https://docs.chmonitor.dev/guide/ai-agent)) if you want to reach the advisor conversationally, or direct API/tool access if you're scripting it.

## Steps

### 1. Point the advisor at a slow query

The advisor takes either a raw SQL string or a `query_id` from `system.query_log`. In the dashboard, ask the AI agent something like:

> Analyze query_id `abc-123` and tell me how to speed it up.

Under the hood this calls the `get_optimization_recommendations` tool, which reads `EXPLAIN` output plus `system.tables`, `system.columns`, `system.data_skipping_indexes`, and `system.parts` for the tables involved — no writes, no DDL execution.

### 2. Read the ranked output

Each recommendation comes back with:

- **The DDL or rewrite text** — a real `ALTER TABLE ... ADD INDEX ...`, `ALTER TABLE ... ADD PROJECTION ...`, or a rewritten `WHERE` → `PREWHERE` clause, ready to copy.
- **Rationale** — why this specific change should help this specific query.
- **Risk and effort** — a skip index is usually low-risk/low-effort; a projection rewrite touches more of the table and costs more to build.
- **Estimated impact** — a granules/bytes-scanned reduction estimate. This is explicitly an *estimate*, not a guarantee — the advisor never runs the query before or after to confirm.

### 3. Review, then apply it yourself

This is the part that matters: **the advisor recommends, it does not execute.** Nothing it returns has been run against your cluster. Before applying any suggested DDL:

- Check it against your actual write patterns — an index or projection that speeds up one query can slow down every insert into that table.
- Run it in a maintenance window if the table is large; `ADD PROJECTION` in particular rewrites existing data in the background.
- Re-run the original slow query afterward and compare `query_duration_ms` from `system.query_log` yourself — the advisor's estimate is a starting point, not a substitute for verifying on your own data.

## Verifying it worked

After applying a recommendation, re-run the query that was slow and pull its latest execution from `system.query_log`:

```sql
SELECT query_id, query_duration_ms, read_rows, read_bytes
FROM system.query_log
WHERE type = 'QueryFinish' AND query_id = {query_id:String}
ORDER BY event_time DESC
LIMIT 1
```

Compare `query_duration_ms` and `read_bytes` against the pre-change baseline. If the numbers didn't move as expected, the advisor's estimate was off for your data distribution — that's a signal to try the next-ranked recommendation, not a bug to report.

## Related

- Docs: [AI agent capabilities](https://docs.chmonitor.dev/guide/ai-agent/capabilities) — `get_optimization_recommendations` and every other recommend-only tool (capacity forecasting, TTL suggestions).
- Docs: [AI agent](https://docs.chmonitor.dev/guide/ai-agent) — quick start and configuration.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] get_optimization_recommendations behavior, inputs (sql or queryId), and read-only/recommend-only scope checked against apps/dashboard/src/lib/ai/agent/tools/advisor-tools.ts.
- [x] Underlying reads (EXPLAIN, system.tables, system.columns, system.data_skipping_indexes, system.parts) checked against docs/content/guide/ai-agent/capabilities.mdx tool table entry for get_optimization_recommendations.
- [x] "Recommend-only, never applies DDL" claim matches both the tool docstring and capabilities.mdx wording exactly — no overclaiming of auto-apply behavior.
- [x] Feature merged to main (plans/46-query-advisor-engine.md referenced in source comments, code present in apps/dashboard/src/lib/ai/agent/tools/advisor-tools.ts).
- [x] Verification query reuses system.query_log columns already verified in clickhouse-slowest-queries-system-query-log.md.
- [x] Docs cross-link resolves (docs/content/guide/ai-agent/capabilities.mdx exists).
-->
