---
name: schema-design-advisor
description: "Recommend table ORDER BY keys, partition strategies, column data-type right-sizing, codecs, skip indexes, and projections for ClickHouse tables."
---

# Schema Design Advisor

Replaces the removed table-design advisor tool. Follow the sections below in order: inspect first, then recommend.

## Inspect First

Gather evidence before making any recommendation. Run all three in parallel.

**1. Schema** — call `get_table_schema` for the target table.

**2. Parts summary** — call `get_table_parts`, or:

```sql
SELECT
    partition,
    count()                                                 AS part_count,
    sum(rows)                                               AS total_rows,
    formatReadableSize(sum(data_compressed_bytes))          AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes))        AS uncompressed,
    round(sum(data_uncompressed_bytes) /
          nullIf(sum(data_compressed_bytes), 0), 2)        AS ratio
FROM system.parts
WHERE active AND database = 'db' AND table = 't'
GROUP BY partition
ORDER BY partition DESC
LIMIT 20
```

**3. Per-column compression + cardinality** — run via `query`:

```sql
SELECT
    name,
    type,
    formatReadableSize(data_compressed_bytes)               AS compressed,
    formatReadableSize(data_uncompressed_bytes)             AS uncompressed,
    round(data_uncompressed_bytes /
          nullIf(data_compressed_bytes, 0), 2)              AS ratio,
    compression_codec
FROM system.columns
WHERE database = 'db' AND table = 't'
ORDER BY data_uncompressed_bytes DESC
```

**4. Cardinality probe** (spot-check suspicious columns):

```sql
SELECT
    uniq(col_a)  AS card_a,
    uniq(col_b)  AS card_b,
    count()      AS total
FROM db.t
```

A ratio < 2× on per-column compression usually means the wrong codec or wrong type. Cardinality drives type and codec choices below.

---

## ORDER BY / Primary Key Design

- **Rule**: list columns low-cardinality → high-cardinality in the `ORDER BY` clause.
- Common ordering: `(tenant_id, date, entity_id, event_id)`.
- Only the first N columns of `ORDER BY` form the sparse index (granule size 8192 rows by default). Columns later in the key still sort data but don't speed up point lookups.
- **Filter alignment**: include in `ORDER BY` every column that appears in `WHERE` clauses of your most frequent queries — leftmost first.
- `PRIMARY KEY` can be a prefix of `ORDER BY` if you want to deduplicate on a broader key (ReplacingMergeTree / CollapsingMergeTree).
- Avoid putting high-cardinality UUIDs first — they destroy index locality.
- When two columns have similar cardinality, put the one queried with `=` before the one queried with `BETWEEN`/range.

---

## Partition Key Choices

| Granularity | DDL | When to use |
|---|---|---|
| Monthly | `PARTITION BY toYYYYMM(event_date)` | Most time-series tables; 1–12 partitions/year |
| Daily | `PARTITION BY toYYYYMMDD(event_date)` | Only when you routinely DROP whole days and have < 1000 partitions total |
| By tenant | `PARTITION BY (tenant_id, toYYYYMM(event_date))` | Multi-tenant with per-tenant data lifecycle |

**Too-many-partitions warning**: ClickHouse merges within a partition, not across. More than ~1000 active partitions per table degrades insert and merge performance (each insert touches one partition; too many partitions = many small parts). Daily partitioning on a high-volume table quickly exceeds safe limits.

Check current partition count:
```sql
SELECT count(DISTINCT partition) FROM system.parts
WHERE active AND database = 'db' AND table = 't'
```

If > 500, recommend coarser partitioning.

---

## Column Data-Type Right-Sizing

### Integer width

| Value range | Type |
|---|---|
| 0–255 | `UInt8` |
| 0–65535 | `UInt16` |
| 0–4 billion | `UInt32` |
| > 4 billion or unknown | `UInt64` |
| Negative small | `Int8`/`Int16`/`Int32` |

Use the narrowest type that fits the actual data range (query `max(col)`, `min(col)`). Narrower types compress better and fit more values per granule.

### Strings

| Situation | Type |
|---|---|
| cardinality < ~10 000 distinct values | `LowCardinality(String)` |
| cardinality > ~100 000 | plain `String` — LC overhead outweighs benefit |
| fixed-width binary/hash (e.g. MD5) | `FixedString(16)` (store raw bytes, not hex) |
| small, known set of values | `Enum8` or `Enum16` (saves space + enforces valid values) |

`LowCardinality` stores a dictionary per column chunk; high-cardinality columns with LC can use more memory than `String`.

### Dates and timestamps

| Need | Type |
|---|---|
| Date only (day precision) | `Date` (2 bytes) |
| Second precision, 1970–2105 | `DateTime` (4 bytes) |
| Sub-second or timezone | `DateTime64(3)` / `DateTime64(6)` (8 bytes) |

Avoid `String` for timestamps — they block time-based pruning and sort incorrectly.

### Nullable

Avoid `Nullable(T)` unless the column genuinely contains NULLs that have semantic meaning. `Nullable` adds a hidden bitmask column and disables some optimizations (skip indexes, certain codecs). Use a sentinel value (0, empty string, epoch) and document the convention instead.

### How to recommend a type change

1. Query `max(col)`, `min(col)`, `uniq(col)`, `countIf(col IS NULL)` to measure range, cardinality, and null rate.
2. Pick the narrowest correct type from the tables above.
3. Check if existing queries rely on implicit casting (e.g. comparing `String` column to integer literal).
4. Emit the ALTER:

```sql
ALTER TABLE db.t MODIFY COLUMN col_name NewType;
```

For large tables this is a background mutation — monitor via `system.mutations`.

---

## Compression Codecs

| Data shape | Recommended codec |
|---|---|
| Monotonically increasing integers (timestamps, IDs) | `Delta, ZSTD(3)` |
| Slow-changing counters | `DoubleDelta, ZSTD(3)` |
| Floating-point gauge metrics | `Gorilla, ZSTD(3)` |
| Integer columns with small value range | `T64, ZSTD(3)` |
| Random strings / UUIDs | `ZSTD(3)` or `LZ4` |
| Already-compressed blobs | `NONE` |

Apply per column:

```sql
ALTER TABLE db.t MODIFY COLUMN ts DateTime CODEC(DoubleDelta, ZSTD(3));
ALTER TABLE db.t MODIFY COLUMN value Float64 CODEC(Gorilla, ZSTD(3));
ALTER TABLE db.t MODIFY COLUMN status LowCardinality(String) CODEC(ZSTD(3));
```

`ZSTD(3)` is a safe default when unsure. `LZ4` is faster to decompress at the cost of compression ratio. Benchmark with `SELECT formatReadableSize(data_compressed_bytes), formatReadableSize(data_uncompressed_bytes) FROM system.columns WHERE ...` before and after.

---

## Skip Indexes

Add skip indexes to columns that appear in `WHERE` but are not in the `ORDER BY` prefix.

| Index type | Best for | Example |
|---|---|---|
| `minmax` | Numeric ranges, dates | `error_code`, `response_time` |
| `set(N)` | Low-cardinality columns (≤ N distinct values per granule) | `status`, `region` |
| `bloom_filter` | String equality / IN on medium-cardinality | `user_agent`, `trace_id` |
| `ngrambf_v1(n, size, hashes, seed)` | LIKE / substring search on strings | `query_text`, `url_path` |

```sql
-- minmax on a numeric column
ALTER TABLE db.t ADD INDEX idx_code error_code TYPE minmax GRANULARITY 4;

-- bloom filter for string equality
ALTER TABLE db.t ADD INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 1;

MATERIALIZE INDEX idx_trace IN PARTITION ID 'all';
```

Skip indexes only help when they skip whole granules (8192 rows). They are useless on columns with near-random values per granule. Verify with `EXPLAIN indexes = 1 SELECT ...`.

---

## Projections and Materialized Views

**Projections** — embedded alternative sort orders stored inside the table. Use when you have a second common query shape with a different leading ORDER BY column:

```sql
ALTER TABLE db.t ADD PROJECTION proj_by_user (
    SELECT * ORDER BY user_id, event_date
);
ALTER TABLE db.t MATERIALIZE PROJECTION proj_by_user;
```

Projections double storage for covered columns. Only add if the query pattern is frequent enough to justify the write amplification.

**Materialized views** — pre-aggregate or transform data into a separate table at insert time. Use for:
- Pre-computed aggregates queried repeatedly (SUM, COUNT by dimension)
- Different granularity (raw events → hourly rollups)
- Derived columns computed at write time to avoid runtime cost

Prefer projections over MVs when the source schema and the query shape are stable. Prefer MVs when you need a different engine (AggregatingMergeTree), different TTL, or cross-table joins at insert time.

---

## Cross-references

- `storage-optimization` — TTL policies, tiered storage, part management, codec benchmarking workflow
- `query-tuning-advisor` — EXPLAIN output, PREWHERE, JOIN ordering, index effectiveness
- `migration-patterns` — ALTER TABLE procedures, mutation monitoring, zero-downtime schema changes
- `hardware-tuning` — memory limits, merge thread tuning, MergeTree settings that affect schema trade-offs
