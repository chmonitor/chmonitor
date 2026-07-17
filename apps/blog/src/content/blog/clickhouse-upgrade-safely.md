---
title: "5 min of ClickHouse: upgrade safely while chmonitor stays connected"
description: "Pre-upgrade checks, the system-table changes that light up new dashboard pages at each version, and the post-upgrade grants sanity queries — so you upgrade ClickHouse without losing monitoring."
date: 2026-07-10
tag: 5 min of ClickHouse
---

Five minutes, one real runbook, no fluff. chmonitor stays connected through a ClickHouse upgrade — it uses versioned SQL (`since` per query config) to automatically pick the right query for the connected version. But a few pre/post checks keep the dashboard fully lit.

## Before you upgrade

```bash
curl -s "https://your-ch-host:8443?query=SELECT+version()" -u monitoring:password
```

chmonitor supports 22.x+, with full coverage recommended from **23.8 LTS**. Back up the settings you'll compare afterward, and clear the backlog that blocks a clean replica upgrade:

```sql
-- Save merge-tree + server settings for comparison
SELECT * FROM system.merge_tree_settings INTO OUTFILE 'merge_tree_settings_before.csv' FORMAT CSV;
SELECT * FROM system.settings INTO OUTFILE 'settings_before.csv' FORMAT CSV;

-- Any stuck mutations (wait or cancel before upgrading a replica)?
SELECT database, table, command, parts_to_do, is_done
FROM system.mutations WHERE is_done = 0 ORDER BY create_time DESC;

-- Long-running merges?
SELECT database, table, round(progress * 100, 2) AS pct, elapsed
FROM system.merges ORDER BY elapsed DESC;

-- Replication health: no read-only replicas, drains should be small
SELECT database, table, replica_name, is_leader, is_readonly, future_parts, queue_size
FROM system.replicas WHERE is_readonly = 1 OR queue_size > 10;
```

## What lights up at each version

- **22.x → 23.x**: Query Views Log, Moves, Dropped Tables, Session Log (Login Attempts/Sessions), Processors Profile Log.
- **23.x → 24.x**: per-user `system.user_processes`, `system.part_log` (Merge Performance), `system.query_metric_log`, `system.query_cache`, `system.data_skipping_indices` (Explorer skip-index panel), `system.view_refreshes`.
- **24.x → 25.x**: `system.distributed_ddl_queue`, extra async-metrics, `system.replicated_merge_tree_settings`.

## After the upgrade

Open `/overview` — if it shows data, the connection and grants are intact. Re-check grants if you upgraded users; ClickHouse sometimes changes system-table visibility across majors:

```sql
SELECT count() FROM system.query_log LIMIT 1;
SELECT count() FROM system.processes LIMIT 1;
SELECT count() FROM system.replicas LIMIT 1;
```

Then roll forward one replica at a time, confirming each rejoins replication (`is_readonly = 0`, `queue_size` draining) before touching the next.

## How chmonitor surfaces this

The AI agent can compare the system tables available now against what the dashboard expects and flag optional tables still missing. The [Health](https://docs.chmonitor.dev/guide/features/health) page rolls cluster status into one grid so you see regressions immediately after cutover.

## Related

- Docs: [ClickHouse User & Grants](https://docs.chmonitor.dev/guide/getting-started/clickhouse-requirements) — re-apply least-privilege grants
- Docs: [Troubleshooting](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Docs: [Health probes (K8s)](https://docs.chmonitor.dev/operate/deploy/k8s#health-probes)
