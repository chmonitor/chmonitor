---
title: "Debugging a spike in system.errors"
description: "How to read system.errors error counters to find what's actually failing in ClickHouse, and why they're cumulative since server start rather than per-incident."
date: 2026-08-28
tag: Troubleshooting
---

An alert fires, or the failed-query count on the health page jumps, and the first instinct is to look at `system.errors`. It's the right instinct — but the table has one property that trips people up the first time: it's a running total since server start, not a per-incident log. Read it wrong and you'll chase a "spike" that's actually just an old error that happened once, months ago.

## Symptoms

- The **Failed Queries (1h)** health check on `/health` crosses its warning (10) or critical (100) threshold.
- Client-visible errors with no obvious single cause — could be a schema mismatch, a quota, or infrastructure (Keeper) trouble.
- Sporadic `KEEPER_EXCEPTION` entries with no clear per-incident timeline.

## Reading system.errors correctly

```sql
SELECT
    name,
    code,
    value AS total_count,
    last_error_time,
    last_error_message
FROM system.errors
WHERE value > 0
ORDER BY value DESC
LIMIT 20
```

`value` is a **cumulative counter since the server last started** — it does not reset per hour or per day. A table showing `value = 4500` for some error code doesn't mean 4500 errors just happened; it means 4500 have happened since the process came up, which could be weeks ago. `last_error_time` and `last_error_message` are what actually tell you whether this error is recent or ancient history — always check those two columns before treating a high `value` as urgent.

For an actual "what's failing right now" view, go to `system.query_log` instead — it has per-query, per-timestamp rows:

```sql
SELECT count() AS failed_count
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
```

This is the query that actually answers "did failures spike in the last hour" — use `system.errors` afterward to identify *which* error code is behind the spike, via `last_error_message`.

## Common causes

**Recent schema or DDL change incompatible with existing clients.** A column drop, rename, or type change that an older client query still references. Check `last_error_message` for the specific error code's most recent occurrence — if it names a missing column or type mismatch, this is almost certainly it.

**Quota or concurrency limits.** `max_concurrent_queries` or a user-level quota being hit under load. These show up as a distinct error code with a `last_error_time` that tracks your traffic pattern (e.g., spiking during a specific batch job).

**Keeper connectivity problems.** `KEEPER_EXCEPTION` is the one error code that has no better per-incident source — `system.errors` (cumulative count plus most recent occurrence) is genuinely the best you get for it, since Keeper failures don't otherwise leave a per-incident row. A sustained run of these usually means Keeper node CPU/disk saturation, a lost quorum, or network partition between Keeper hosts.

## Fix

- **Match the error code to `last_error_message` first** — don't act on `value` alone; it conflates "happened once, ages ago" with "happening right now."
- **Schema/DDL mismatches** are a client-side fix — update the client query or roll the schema change out more carefully (e.g., add-then-migrate instead of drop-then-recreate).
- **Quota/concurrency errors** are a capacity decision — raise the limit if the load is legitimate, or find and throttle the offending client if it isn't.
- **`KEEPER_EXCEPTION` runs** need Keeper-side investigation (node health, quorum, network) — chmonitor can surface that this is happening, it can't fix Keeper infrastructure for you.

## How chmonitor surfaces this

The **Failed Queries (1h)** health check on `/health` tracks the `system.query_log`-based recent-failure count at the same 10/100 warning/critical thresholds shown above, with a detail view of the actual failing queries. The **Keeper Exceptions (1h)** health check separately tracks `KEEPER_EXCEPTION` counts and explicitly notes in its detail view that the underlying count is cumulative-since-start, not per-hour, so you don't misread it. The AI agent has direct read access to `system.errors` via the `query` tool and its `system-tables` skill.

## Related

- Docs: [Health checks](https://docs.chmonitor.dev/guide/features/health) — Failed Queries and Keeper Exceptions checks and their thresholds.
- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries) — the Failed Queries page for per-query detail.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] system.errors columns (name, code, value, last_error_time, last_error_message) checked against apps/dashboard/src/lib/ai/agent/prompts/clickhouse-instructions.ts line noting "NOT last_update_time" and apps/dashboard/src/lib/query-config/queries/common-errors.ts.
- [x] "value is cumulative since server start" claim checked against apps/dashboard/src/components/health/health-checks.ts keeper-exceptions detailDescription, which states this explicitly.
- [x] Failed Queries health check thresholds (warning 10, critical 100) and SQL checked against apps/dashboard/src/components/health/health-checks.ts 'failed-queries' entry.
- [x] Keeper Exceptions health check thresholds (warning 1, critical 20) and common causes checked against the same file's 'keeper-exceptions' entry.
- [x] chmonitor is described as surfacing, not auto-fixing, Keeper infrastructure issues — matches the "chmonitor can only surface this, not fix it" template guidance.
- [x] Docs cross-links (guide/features/health, guide/features/queries) confirmed to exist.
-->
