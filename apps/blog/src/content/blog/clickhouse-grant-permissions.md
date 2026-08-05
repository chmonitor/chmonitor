---
title: "5 min of ClickHouse: GRANT permissions without giving away the keys"
description: "The ClickHouse GRANT syntax you actually use, a least-privilege monitoring user pattern, and how FLUSH PRIVILEGES fits in."
date: 2026-08-05
tag: 5 min of ClickHouse
---

`GRANT` in ClickHouse is simpler than in Postgres but the mistake pattern is the same: a monitoring user with `ALL PRIVILEGES` "just to make it work." It works — until it doesn't. This post covers the syntax, a practical least-privilege pattern, and what `FLUSH PRIVILEGES` actually does.

## The GRANT syntax

```sql
-- Grant on a single table
GRANT SELECT ON my_db.events TO monitoring_user;

-- Grant on an entire database
GRANT SELECT ON my_db.* TO monitoring_user;

-- Grant CREATE + INSERT on a database (e.g. for materialized views)
GRANT CREATE TABLE, INSERT ON my_db.* TO monitoring_user;

-- Multiple privileges at once
GRANT SELECT, SHOW TABLES ON my_db.* TO monitoring_user;
```

Revoke the same way:

```sql
REVOKE SELECT ON my_db.* FROM monitoring_user;
```

## What privileges a monitoring user actually needs

A read-only monitoring user only needs:

| Privilege | Purpose |
|---|---|
| `SELECT` | Read system tables and any tables you want to surface in dashboards |
| `SHOW TABLES` | List tables in a database |
| `SHOW COLUMNS` | Inspect table schemas |

That's it. No `INSERT`, no `CREATE TABLE`, no `ALTER`, no `DROP`.

```sql
-- Create the user (if not using an auth system that manages users)
CREATE USER monitoring_user IDENTIFIED WITH plaintext_password BY 'secure-password';

-- Grant the minimum
GRANT SELECT, SHOW TABLES, SHOW COLUMNS ON my_db.* TO monitoring_user;
```

## The principle of least privilege for monitoring

ClickHouse's monitoring tools need read access to system tables. The system tables a typical monitoring setup queries:

- `system.query_log` — finished and running queries
- `system.processes` — currently running queries
- `system.merges` — active merge operations
- `system.replicas` — replication status
- `system.parts` — data parts per table
- `system.settings` — current server settings
- `system.asynchronous_metrics` — resource usage (CPU, memory, disk)
- `system.errors` — recent errors
- `system.metrics` — current metric values
- `system.disk_usage` — disk space

Granting `SELECT` on `my_db.*` covers the application tables. System tables are accessible to all users by default — no separate grant needed.

```sql
-- Verify the user can see what they need
SET user = 'monitoring_user';
SELECT count() FROM system.query_log LIMIT 1;
SELECT count() FROM system.processes LIMIT 1;
SELECT count() FROM system.replicas LIMIT 1;
```

## When you need CREATE TABLE

Materialized views require the monitoring user to have `CREATE TABLE` and `INSERT` on the target database. If you're using chmonitor's advisor tools to suggest MV-backed rollups, the agent needs those grants on the database where it creates the target table.

```sql
-- For MV creation only, not general INSERT
GRANT CREATE TABLE, INSERT ON my_db.* TO monitoring_user;
```

Keep this scoped to the database where MVs are actually created, not `*.*`.

## FLUSH PRIVILEGES

In ClickHouse, `GRANT` and `REVOKE` are applied immediately — there is no `FLUSH PRIVILEGES` statement. Privilege changes take effect without a reload. If you see documentation referencing it, that's from the MySQL world; ClickHouse doesn't need it.

If you're using an external auth system (LDAP, Kerberos) alongside ClickHouse's internal user management, the external system handles its own privilege refresh — ClickHouse's internal grants are always live.

## Auditing what a user can do

```sql
-- What grants does monitoring_user have?
SHOW GRANTS FOR monitoring_user;

-- Full grant tree including role grants
SELECT * FROM system.grants WHERE user_name = 'monitoring_user';
```

## How chmonitor surfaces this

chmonitor's connection form validates that the monitoring user can read the system tables it needs before saving the connection. If a grant is missing, it reports which table is inaccessible. The [ClickHouse User & Grants docs](https://docs.chmonitor.dev/guide/getting-started/clickhouse-requirements) walk through the exact grants for a read-only monitoring user.

## Related

- Docs: [ClickHouse User & Grants](https://docs.chmonitor.dev/guide/getting-started/clickhouse-requirements)
- Docs: [Troubleshooting guide](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Previous in the series: [Escaping MEMORY_LIMIT_EXCEEDED](/clickhouse-memory-limit-exceeded/)
