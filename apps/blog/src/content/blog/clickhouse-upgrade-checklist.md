---
title: "5 min of ClickHouse: a ClickHouse upgrade checklist that doesn't break monitoring"
description: "Pre-upgrade checks, the system-table changes that light up new dashboard pages at each version, and post-upgrade grant verification — so you upgrade ClickHouse without losing visibility."
date: 2026-08-05
tag: 5 min of ClickHouse
---

ClickHouse upgrades are usually smooth, but the thing that breaks is almost always monitoring — not the data. A missing system table after a version jump, a grant that no longer applies, or a replica that never rejoins replication. This checklist covers what to verify before and after.

## Before the upgrade

```sql
-- Current version
SELECT version();

-- Stuck mutations (wait or cancel before upgrading a replica)
SELECT database, table, command, parts_to_do, is_done
FROM system.mutations WHERE is_done = 0 ORDER BY create_time DESC;

-- Active merges (should drain before upgrading)
SELECT database, table, round(progress * 100, 2) AS pct, elapsed
FROM system.merges ORDER BY elapsed DESC;

-- Replication health
SELECT database, table, replica_name, is_leader, is_readonly, future_parts, queue_size
FROM system.replicas WHERE is_readonly = 1 OR queue_size > 10;
```

Back up settings you'll compare after:

```sql
SELECT * FROM system.merge_tree_settings INTO OUTFILE 'merge_tree_settings_before.csv' FORMAT CSV;
SELECT * FROM system.settings INTO OUTFILE 'settings_before.csv' FORMAT CSV;
```

## System tables that appear at each version

ClickHouse adds system tables across versions. chmonitor uses versioned SQL (`since` per query config) to automatically pick the right query, but it's useful to know what lights up:

| Upgrade | New system tables / tables |
|---|---|
| 22.x → 23.x | `system.query_views_log`, `system.moves`, `system.dropped_tables`, `system.session_log` |
| 23.x → 24.x | `system.user_processes`, `system.part_log`, `system.query_metric_log`, `system.query_cache`, `system.data_skipping_indices`, `system.view_refreshes` |
| 24.x → 25.x | `system.distributed_ddl_queue`, additional async metrics, `system.replicated_merge_tree_settings` |

Each new table unlocks new dashboard pages in chmonitor automatically.

## After the upgrade

Verify the connection is intact:

```sql
SELECT count() FROM system.query_log LIMIT 1;
SELECT count() FROM system.processes LIMIT 1;
SELECT count() FROM system.replicas LIMIT 1;
```

If any of these return 0 or error, the grants changed. ClickHouse occasionally tightens system-table visibility across majors — re-apply grants if the monitoring user lost access.

Check replication rejoined:

```sql
SELECT database, table, replica_name, is_readonly, queue_size
FROM system.replicas;
```

Roll forward one replica at a time. Confirm each rejoins (`is_readonly = 0`, `queue_size` draining) before touching the next.

## Common gotchas

- **system.part_log** requires `allow_experimental_part_log` on some older 23.x builds — chmonitor handles this gracefully by marking the Parts page optional when the table is missing.
- **Grant syntax** changed in 23.x for some edge cases. Re-apply grants from a backup if you get "not found" errors after a major upgrade.
- **Settings files** (`users.xml`, `merged.xml`) — if you manage these in config management, diff them against the version-specific defaults. New versions sometimes add new required settings.

## How chmonitor surfaces this

chmonitor stays connected through upgrades using version-aware queries. The [Health](https://docs.chmonitor.dev/guide/features/health) page highlights missing system tables and replication issues immediately after a version cutover. The AI agent can compare the system tables your version supports against what the dashboard expects and flag anything still absent.

## Related

- Docs: [ClickHouse User & Grants](https://docs.chmonitor.dev/guide/getting-started/clickhouse-requirements)
- Docs: [Troubleshooting](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Docs: [K8s health probes](https://docs.chmonitor.dev/operate/deploy/k8s#health-probes)
- Previous in the series: [GRANT permissions without giving away the keys](/clickhouse-grant-permissions/)
