---
name: migration-patterns
description: "Schema migrations: ALTER patterns, engine changes, zero-downtime swaps, clickhouse-local offline migrations, lightweight UPDATE/DELETE strategies, and Postgres→ClickHouse migration planning (type mapping, schema pitfalls, PeerDB CDC, validation, schema introspection)."
---

# Migration Patterns

## ALTER TABLE Operations
- Add column: `ALTER TABLE t ADD COLUMN col Type [DEFAULT expr] [AFTER existing_col]`
- Drop column: `ALTER TABLE t DROP COLUMN col`
- Modify type: `ALTER TABLE t MODIFY COLUMN col NewType` (must be compatible)
- Rename: `ALTER TABLE t RENAME COLUMN old TO new`
- These are metadata-only operations — instant for most changes

## Engine Changes
- Cannot ALTER engine directly
- Pattern: create new table → insert from old → rename
```sql
CREATE TABLE t_new ENGINE = ReplacingMergeTree() ORDER BY id AS SELECT * FROM t_old;
RENAME TABLE t_old TO t_backup, t_new TO t_old;
```
- For large tables: use `INSERT INTO ... SELECT` with batching

## EXCHANGE TABLES (v22.5+)
- Atomic swap without RENAME chain: `EXCHANGE TABLES t_old AND t_new`
- Simpler and safer than `RENAME TABLE t_old TO t_backup, t_new TO t_old`
- Both tables must exist and be in the same database

## Zero-Downtime Migrations
1. Create new table with desired schema
2. Create materialized view to capture new inserts: `CREATE MATERIALIZED VIEW mv TO t_new AS SELECT ... FROM t_old`
3. Backfill historical data: `INSERT INTO t_new SELECT ... FROM t_old`
4. Verify data consistency
5. Switch application to new table
6. Drop old table and materialized view

## Data Backfill Patterns
- Batch by partition: `INSERT INTO new SELECT * FROM old WHERE toYYYYMM(date) = 202301`
- Use `max_insert_block_size` and `max_threads` for throughput control
- Monitor with `system.processes` and `system.merges`
- Verify row counts match after backfill

## Lightweight Mutations
- `ALTER TABLE t UPDATE col = expr WHERE condition` — async by default (`mutations_sync = 0`)
- Track progress: `SELECT * FROM system.mutations WHERE table = 't'`
- `ALTER TABLE t DELETE WHERE condition` — rewrites affected parts
- Throttle impact: set `max_rows_per_mutation` to limit rows per mutation batch
- Always schedule heavy mutations off-peak; monitor `system.mutations` for completion

## Cross-Server Migration
- Use `remote()` table function to copy between servers:
```sql
INSERT INTO local_db.t SELECT * FROM remote('source_host:9000', 'db', 't', 'user', 'pass')
```
- For large tables, batch by partition or use `clickhouse-local` offline approach

## clickhouse-local Offline Migrations
- Run migrations without a running server: `clickhouse-local --file migration.sql`
- Useful for schema changes on cold data or CI/CD validation
- Can operate directly on data files: `clickhouse-local -S 'col1 Type1, col2 Type2' --input-format Native < data.bin`

## Schema Migration Versioning
- Track applied migrations with a dedicated table:
```sql
CREATE TABLE _schema_migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = TinyLog;
```
- Insert a row after each successful migration; check before applying
- Integrate with deployment scripts for idempotent migration runs

## Partition Operations
- `ALTER TABLE t ATTACH PARTITION id FROM other_table` — zero-copy if same structure
- `ALTER TABLE t REPLACE PARTITION id FROM other_table` — atomic swap
- `ALTER TABLE t MOVE PARTITION id TO TABLE other_table` — move data

## Common Pitfalls
- Nullable to non-Nullable requires default value for existing NULLs
- Changing ORDER BY requires table recreation
- Mutations (UPDATE/DELETE) rewrite all parts — schedule off-peak
- Test migrations on staging with production data volumes
- `EXCHANGE TABLES` fails if either table is replicated with different replica paths

---

# Postgres → ClickHouse Migration Planning

Advisory only. This section helps you *plan* a Postgres→ClickHouse migration and
*recommend* the tooling chmonitor already ships — it never executes a migration.
Follow the same phased workflow ClickHouse Cloud uses for its managed-Postgres
onboarding: **discovery → schema design → type mapping → CDC ingestion →
validation**. Do each phase before the next.

## 1. Discovery (introspect the source, read-only)

Ground every recommendation in the user's actual schema, not generic advice.
Once Postgres connectivity ships (issues #2449/#2451 add a read-only Postgres
query path), run these advisory `information_schema` / `pg_catalog` queries via
that path — they are `SELECT`-only and safe against a production replica. Until
that path exists, hand these to the user to run themselves and paste back.

**Tables and row estimates** (sizing the migration):

```sql
SELECT n.nspname AS schema, c.relname AS table,
       c.reltuples::bigint AS est_rows,
       pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY total_bytes DESC;
```

**Columns and types** (drives the type-mapping table below):

```sql
SELECT table_schema, table_name, column_name, ordinal_position,
       data_type, udt_name, is_nullable,
       numeric_precision, numeric_scale, character_maximum_length
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema, table_name, ordinal_position;
```

**Primary keys / unique constraints** (drives ORDER BY + dedup strategy):

```sql
SELECT tc.table_schema, tc.table_name, tc.constraint_type, kcu.column_name,
       kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema = kcu.table_schema
WHERE tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
  AND tc.table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY tc.table_name, kcu.ordinal_position;
```

**Indexes** (candidates for ORDER BY, skip indexes, or projections):

```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY tablename;
```

**Foreign keys** (denormalize or JOIN-at-query-time candidates):

```sql
SELECT tc.table_name, kcu.column_name,
       ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema NOT IN ('pg_catalog','information_schema');
```

## 2. Type Mapping (Postgres → ClickHouse)

Map every source column to a ClickHouse type. Use the exact source type from the
`information_schema.columns` query above (`udt_name` + `numeric_precision/scale`).

| Postgres type | ClickHouse type | Notes |
|---------------|-----------------|-------|
| `smallint` | `Int16` | |
| `integer` / `int` / `int4` | `Int32` | |
| `bigint` / `int8` | `Int64` | |
| `serial` / `bigserial` / `GENERATED … AS IDENTITY` | plain `Int32` / `Int64` | ClickHouse has **no auto-increment**. Migrate the existing values as ordinary integers; generate new ids app-side (e.g. snowflake) or with `generateSnowflakeID()` — do not expect a sequence. |
| `numeric(p,s)` / `decimal(p,s)` | `Decimal(p,s)` | Exact. Keep `p ≤ 76`; pick the narrowest of `Decimal32/64/128/256` that fits `p`. |
| `numeric` / `decimal` (no precision) | `String` **or** `Float64` | Unbounded/variable precision has no fixed ClickHouse type. `Float64` is fast but lossy (not exact for money); `String` preserves exact text but isn't arithmetic. Choose per column — money/exact → `String` (or a bounded `Decimal` if you can pin `p,s`), analytics-approximate → `Float64`. |
| `real` / `float4` | `Float32` | |
| `double precision` / `float8` | `Float64` | |
| `money` | `Decimal(18,2)` | Postgres `money` is locale-formatted; strip formatting on export. |
| `text` / `varchar(n)` / `char(n)` / `citext` | `String` | ClickHouse `String` is unbounded; the `(n)` length limit is not enforced (add a `CHECK`/constraint only if you need it). `LowCardinality(String)` for low-distinct-value columns (statuses, enums). |
| `boolean` | `Bool` | Alias of `UInt8` (0/1). |
| `uuid` | `UUID` | Native 16-byte type. |
| `bytea` | `String` | ClickHouse `String` is a byte string; store raw bytes directly. |
| `json` / `jsonb` | `JSON` (24.8+) **or** `String` | Prefer the native `JSON` type on 24.8+ (typed sub-column access, no reparsing). On older servers use `String` and query with `JSONExtract*`/`simpleJSONExtract*`. `jsonb`→`JSON` loses nothing semantically; key order is not preserved either way. |
| `date` | `Date` (or `Date32` for < 1970 / > 2149) | `Date` covers 1970-01-01…2149-06-06; use `Date32` for wider ranges. |
| `timestamp` (without time zone) | `DateTime64(6)` | Microsecond precision matches Postgres. Choose the scale to match the source (`0`=s, `3`=ms, `6`=µs). |
| `timestamptz` (with time zone) | `DateTime64(6, 'UTC')` | **Timezone caveat:** Postgres stores `timestamptz` as UTC internally and converts on display; ClickHouse stores the raw value and attaches a *display* timezone. Normalize the export to UTC and pin `'UTC'` in the type so values are unambiguous. Do timezone conversion at query time with `toTimeZone(col, 'America/New_York')`, never by baking a local zone into storage. |
| `time` / `timetz` | `String` or `UInt32` (seconds since midnight) | No native time-of-day type; pick a representation. |
| `interval` | `Int64` (seconds/µs) or `String` | No native interval type. |
| `inet` / `cidr` | `IPv4` / `IPv6` (or `String`) | Use `IPv4`/`IPv6` for equality/range filters; `String` if you need the original text. |
| `array` (`int[]`, `text[]`, …) | `Array(T)` | Map element type per this table, e.g. `int[]`→`Array(Int32)`, `text[]`→`Array(String)`. Postgres multi-dimensional arrays → nested `Array(Array(T))`. |
| `hstore` | `Map(String, String)` | |
| `enum` | `Enum8`/`Enum16` or `LowCardinality(String)` | `LowCardinality(String)` is more flexible (adding values needs no ALTER). |
| `point` / `geometry` (PostGIS) | `Point` / `Ring` / `Polygon` (or `String`) | ClickHouse geo types are limited; store WKT `String` when unsure. |

**Nullability:** map `is_nullable = 'YES'` to `Nullable(T)` **only when NULL is
semantically meaningful.** `Nullable()` costs a separate null-mask column and
disqualifies the column from some optimizations. Prefer a sentinel default
(`0`, `''`, epoch) for NOT-NULL-in-practice columns; reserve `Nullable()` for
genuine tri-state data.

## 3. Schema Design Pitfalls (relational → columnar)

ClickHouse is not a drop-in relational target. The biggest planning mistakes:

- **PRIMARY KEY → ORDER BY (sorting key), not a uniqueness constraint.** A
  MergeTree `ORDER BY` defines the sort/primary-key index; it does **not**
  enforce uniqueness. Choose it for query patterns, not because Postgres had a
  PK there. Order columns **low-cardinality → high-cardinality** (e.g.
  `ORDER BY (tenant_id, event_type, toStartOfHour(ts), user_id)`) so the sparse
  primary index and granule pruning are effective. A high-cardinality leading
  column (like a bare `uuid` PK) makes the index almost useless. See the
  `schema-design-advisor` skill for ORDER BY selection detail.
- **Unique constraints don't exist.** ClickHouse won't reject duplicate rows.
  If the source relies on a unique/primary key for dedup, model it with
  `ReplacingMergeTree(version)` keyed on that column via `ORDER BY`, and read
  with `SELECT … FINAL` (or `argMax`/`GROUP BY`) to collapse duplicates.
  **FINAL caveat:** it merges at query time and is expensive on large scans;
  dedup happens lazily in background merges, so pre-merge reads can still see
  duplicates. Don't assume "eventually unique" == "unique now."
- **B-tree / secondary indexes → skip indexes or projections.** There's no
  per-row secondary index. For occasional point-lookups on a non-sorting
  column, add a data-skipping index (`INDEX idx col TYPE minmax|set|bloom_filter
  GRANULARITY n`). For a whole alternative access pattern (different ORDER BY),
  use a **projection** instead. Most Postgres b-tree indexes should simply be
  dropped — the sorting key replaces the primary one.
- **Foreign keys don't exist and aren't enforced.** Two paths: **denormalize**
  (fold the referenced columns into the fact table at ingest — the columnar-DB
  default, trades storage for JOIN-free reads), or **JOIN at query time**
  against a `Dictionary` / small dimension table (good for small, slowly
  changing lookups via `dictGet`). Prefer denormalization for hot analytical
  paths.
- **NULLs and `Nullable()` cost.** As above — every `Nullable` column carries a
  null-mask and blocks some optimizations. Audit which columns truly need it.
- **Updates & deletes → CDC-friendly engines, not in-place mutations.**
  ClickHouse `ALTER … UPDATE/DELETE` are heavyweight async mutations (see
  *Lightweight Mutations* above) — wrong for high-frequency row changes. For a
  replicated OLTP source, model mutability with the engine:
  - `ReplacingMergeTree(version)` — last-write-wins upserts; the CDC `version`
    column (e.g. Postgres LSN or `updated_at`) picks the surviving row.
  - `CollapsingMergeTree(sign)` / `VersionedCollapsingMergeTree(sign, version)`
    — cancel out old row versions with `sign = -1` / `+1` pairs; suits
    delete-heavy or exact-count workloads.
  Deletes become a tombstone row (`sign = -1`, or a soft-delete flag) rather
  than a physical `DELETE`. This is exactly the shape PeerDB writes (below).

## 4. CDC Ingestion — use chmonitor's PeerDB integration

**Recommend PeerDB.** chmonitor already integrates PeerDB as its CDC mechanism —
do not invent a Debezium/Kafka-Connect/other-tool HOWTO. PeerDB streams a
Postgres source into a ClickHouse destination over logical replication (WAL),
and chmonitor already models and monitors these mirrors:

- Mirrors move data between typed peers — `DBType.POSTGRES` (source) →
  `DBType.CLICKHOUSE` (destination). chmonitor normalizes these peer types in
  `components/peerdb/peerdb-utils.ts` (`normalizeDbType` / `dbTypeLabel`, the
  `DB_TYPE_BY_ORDINAL` map where `3 = POSTGRES`, `8 = CLICKHOUSE`).
- A **CDC mirror** runs the phases chmonitor already visualizes
  (`PHASE_FLOWS.CDC` in `peerdb-utils.ts`): **Setup** (replication slot +
  publication + table init) → **Initial snapshot** (backfill existing rows) →
  **Snapshot done** → **CDC streaming** (tailing the WAL, ongoing). PeerDB
  applies inserts/updates/deletes into a `ReplacingMergeTree`-style destination,
  which is why the engine choices in §3 matter.
- chmonitor is **view-only** over an externally-run PeerDB flow-api
  (`apps/dashboard/src/lib/peerdb/peerdb-config.ts`, single instance via
  `PEERDB_API_URL`). It reports mirror/flow status; it does **not** create
  mirrors or give ad-hoc Postgres SQL access. So the skill's role is to *plan*
  the target schema and *point the user at* the PeerDB pages to run and watch
  the mirror — not to stand up the pipeline.
- The PeerDB pages live under `src/routes/(peerdb)/peerdb/` (`peers`, `mirror`,
  partitions, logs). Direct the user there to create the Postgres→ClickHouse
  mirror and monitor snapshot progress + ongoing replication lag.

**Managed-cloud analog:** on ClickHouse Cloud, **ClickPipes** (its native
Postgres CDC connector) plays the same role as PeerDB — mention it as the
managed option for Cloud users, but chmonitor's shipped integration is PeerDB.

## 5. Validation Checklist

After the initial snapshot completes and CDC is streaming, verify parity before
cutover. All checks are read-only:

- **Row counts per table.** Compare `SELECT count() FROM ch_table` against the
  Postgres `SELECT count(*) FROM pg_table` (or the discovery `reltuples`
  estimate for a fast first pass). Expect small transient drift while CDC is
  live — recheck at a quiesced point.
- **Aggregate / checksum comparison.** Beyond counts, compare column-level
  aggregates that would catch type-mapping errors: `sum()`/`avg()`/`min()`/`max()`
  on numeric columns, `count(distinct …)` on keys, and per-day/`toStartOfDay`
  row-count histograms to catch timezone shifts on `timestamptz` columns. A
  matching `sum(amount)` and `max(updated_at)` per partition is strong evidence
  the mapping is correct.
- **Replication-lag monitoring via the PeerDB pages.** Watch snapshot progress
  and steady-state lag on the mirror/partitions pages under
  `src/routes/(peerdb)/peerdb/` (chmonitor surfaces slot size, WAL, and lag —
  see the `pdbFmtLag` / `pdbFmtBytes` formatters). Cut over only when the mirror
  is `STATUS_RUNNING` with lag near zero and stable.
- **Dedup correctness (ReplacingMergeTree).** If the destination uses
  `ReplacingMergeTree`, run comparison counts with `FINAL` (or `argMax`) so you
  compare deduplicated rows, not raw parts still awaiting merge.

## Postgres-migration Pitfalls (quick reference)

- Don't copy the Postgres PK as the ClickHouse `ORDER BY` blindly — order by
  cardinality for the read pattern.
- `numeric` without precision has no exact ClickHouse type — decide `String` vs
  `Float64` per column.
- `timestamptz` needs UTC normalization + a pinned `'UTC'` display zone;
  convert with `toTimeZone` at query time.
- No auto-increment — `serial`/identity becomes a plain integer; new ids are the
  app's job.
- Uniqueness/FKs aren't enforced — model dedup with `ReplacingMergeTree`+`FINAL`
  and denormalize FKs (or use `Dictionary` JOINs).
- Recommend PeerDB (chmonitor's shipped CDC), ClickPipes as the Cloud analog —
  not a generic CDC stack.
