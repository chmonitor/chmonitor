---
title: "Why is my ClickHouse replication lagging?"
description: "Reading absolute_delay and queue_size from system.replicas to find and fix ClickHouse replication lag before readers see stale data."
date: 2026-07-24
tag: Troubleshooting
---

Reads from a replica are returning data that's minutes — or hours — out of date, but writes to the leader look fine. That's replication lag: the replica has fallen behind on applying the replication log, and anyone reading from it sees a stale snapshot instead of an error, which makes it easy to miss until someone notices the numbers don't add up.

## Symptoms

- A read query against a replica returns different (older) results than the same query against the leader.
- chmonitor's [Replicas](https://docs.chmonitor.dev/guide/features) page shows a non-zero `absolute_delay` or a growing `queue_size` for one or more tables.
- The **Replication Lag** health check (`/health`) trips its warning (30s) or critical (300s) threshold.

## Common causes

### Fetch backlog on the replica

Every write to the leader is recorded in the replication log; each replica has to fetch and apply those log entries. If fetches can't keep up — slow network, saturated inter-server bandwidth, or a replica that's simply under-provisioned relative to the leader's write rate — the backlog grows and `absolute_delay` climbs.

```sql
SELECT
    database,
    table,
    is_leader,
    is_readonly,
    absolute_delay,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    total_replicas,
    active_replicas
FROM system.replicas
WHERE absolute_delay > 0 OR queue_size > 0
ORDER BY absolute_delay DESC
```

`absolute_delay` is seconds behind the leader — treat anything sustained above 300s (5 minutes) as a real concern, not noise. `queue_size` is how many replication-log entries are still queued for this replica to apply; a large, growing queue confirms the replica is falling behind rather than just having a brief blip.

### Keeper / ZooKeeper connectivity problems

Replication coordination goes through ClickHouse Keeper (or ZooKeeper). If a replica loses its Keeper session, or Keeper itself is under latency pressure, replication stalls entirely rather than just slowing down.

```sql
SELECT
    database,
    table,
    is_readonly,
    is_session_expired,
    zookeeper_path,
    zookeeper_exception,
    last_queue_update_exception
FROM system.replicas
WHERE is_readonly = 1 OR is_session_expired = 1 OR zookeeper_exception != ''
```

`is_readonly = 1` means the replica currently can't accept writes at all — almost always a Keeper connectivity issue, not a disk or CPU problem. A non-empty `zookeeper_exception` or `last_queue_update_exception` tells you exactly what Keeper is complaining about.

### Stuck or failing replication-queue entries

`system.replicas` tells you *that* a replica is behind; `system.replication_queue` tells you *what specific task* is stuck.

```sql
SELECT
    database,
    table,
    type,
    is_currently_executing,
    num_tries,
    num_postponed,
    postpone_reason,
    last_exception,
    last_exception_time
FROM system.replication_queue
ORDER BY is_currently_executing DESC, create_time DESC
LIMIT 50
```

A high `num_tries` with a populated `last_exception` means one task (usually a `MERGE_PARTS` or `GET_PART` fetch) is failing repeatedly and blocking everything queued behind it — the queue is largely FIFO per table.

## Fix

- **Restore Keeper connectivity first** if `is_readonly = 1` or `is_session_expired = 1` — nothing else matters until the replica can talk to Keeper again. Once connectivity is restored, `SYSTEM RESTART REPLICA db.table` forces the replica to re-sync its local replication state against Keeper.
- **Check network bandwidth between replicas** if `is_readonly = 0` but `absolute_delay` keeps growing — this points at a genuine fetch-throughput problem, not a coordination failure.
- **Investigate the specific `last_exception`** from `system.replication_queue` for a stuck task before assuming it's a generic lag problem — a repeatedly failing fetch (missing part, checksum mismatch) needs a different fix than pure backpressure.
- Sustained lag caused by a genuinely overloaded replica (not a transient blip) is a capacity problem — add replicas or resize, don't just wait it out.

## How chmonitor surfaces this

The **Replication Lag** health check on `/health` tracks `max(absolute_delay)` across all replicas continuously, at the same 30s/300s warning/critical thresholds used above. The [Replicas](https://docs.chmonitor.dev/guide/features) page shows the same `system.replicas` columns (`absolute_delay`, `queue_size`, `is_readonly`, `is_leader`) per table, and [Replication Queue](https://docs.chmonitor.dev/guide/features) shows the `system.replication_queue` detail for a stuck task. The AI agent's `get_replication_status` tool runs the diagnostic above on request — ask it "which tables are lagging and why."

## Related

- Docs: [Features overview](https://docs.chmonitor.dev/guide/features) — the Replicas and Replication Queue pages this post walks through.
- Docs: [Health checks](https://docs.chmonitor.dev/guide/features/health) — the Replication Lag health check and its thresholds.
- Docs: [AI agent](https://docs.chmonitor.dev/guide/ai-agent) — `get_replication_status` and the replication-diagnosis skill.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] system.replicas columns (absolute_delay, queue_size, is_leader, is_readonly, is_session_expired, zookeeper_exception, last_queue_update_exception) checked against apps/dashboard/src/lib/query-config/tables/replicas.ts and skills/registry.ts.
- [x] system.replication_queue columns checked against apps/dashboard/src/lib/query-config/tables/replication-queue.ts.
- [x] Health-check thresholds (warning 30s, critical 300s) checked against apps/dashboard/src/components/health/health-checks.ts ('replication-lag' entry).
- [x] SYSTEM RESTART REPLICA fix matches the registry.ts replication-guide skill wording.
- [x] get_replication_status tool checked against apps/dashboard/src/lib/ai/agent/tools/replication-tools.ts — reads system.replicas as described.
- [x] Docs cross-links point at real docs/content pages (guide/features, guide/features/health, guide/ai-agent).
-->
