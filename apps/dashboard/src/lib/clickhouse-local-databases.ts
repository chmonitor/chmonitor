/**
 * Shared SQL fragment that restricts a `system.tables` / `system.columns` scan
 * to databases whose metadata lives on the node being queried.
 *
 * Why this exists: ClickHouse's table catalogs are not all local. Databases on
 * a **remote database engine** (`PostgreSQL`, `MySQL`, `MaterializedPostgreSQL`,
 * …) are not stored in this server — listing one makes ClickHouse open a
 * connection to the remote server and build `create_table_query` /
 * `engine_full` there, once per table. That remote catalog call cannot be
 * interrupted, so `max_execution_time` does not save it: on a single-node 26.7
 * holding 3,600 `PostgreSQL`-engine tables, the health parts-pressure queries
 * measured 7,493–297,721 ms server-side before the filter and 18 ms after.
 *
 * Only engines that can hold MergeTree tables with parts on the local node are
 * in the list, because a health query over parts / TTL / partition keys has
 * nothing to say about a table that cannot have any.
 *
 * ## Engine allow-list vs `is_external`
 *
 * ClickHouse 26.x adds `system.databases.is_external`, which flags exactly the
 * remote-engine databases (`pgdb` → 1 on a real 26.7 server). It reads better,
 * but the column does not exist on 23.8 or 24.3 (verified: `SELECT ... WHERE
 * is_external = 1` fails on both), and the supported LTS range starts at 23.3
 * (`docs/content/reference/support-matrix.mdx`). `system.databases.engine`, by
 * contrast, exists on every version in that range. So the portable form is an
 * allow-list on `engine`.
 *
 * ## The tradeoff, stated plainly
 *
 * An allow-list is fail-closed for performance and fail-open for coverage: an
 * engine ClickHouse adds later is excluded until someone names it here, and its
 * tables silently drop out of a health check. That is the cheaper failure — a
 * missing row beats a check that times out on every sweep — but it is a real
 * regression, so re-run the probe below when adding a ClickHouse version.
 *
 * ## Version evidence
 *
 * `system.database_engines` exists on 24.3+ and is the authoritative list.
 * It does not exist on 23.8, so 23.8 was probed with
 * `CREATE DATABASE zz_probe ENGINE = <name>()`, classifying the response:
 * `Database engine name 'X' does not exist` → not registered; anything else
 * (missing arguments, experimental-feature gating) → registered.
 *
 * | Engine | 23.8.16.16 | 24.3.18.7 | 26.7.22.4 | In the filter |
 * |:---|:---:|:---:|:---:|:---:|
 * | `Atomic` | yes | yes | yes | **yes** — default since 20.x, `store/` on local disk |
 * | `Ordinary` | yes | yes | yes (deprecated) | **yes** — pre-20.x default, still in use |
 * | `Lazy` | yes | yes | **no** (removed) | **yes** — pre-20.x default; harmless where absent |
 * | `Memory` | yes | yes | yes | **yes** — see the note below |
 * | `Replicated` | yes (experimental) | yes (experimental) | yes | **yes** — Keeper-replicated, metadata is node-local |
 * | `Shared` | no | no | no | **yes** — Cloud-only, unverifiable here; see below |
 * | `MaterializedMySQL` | yes (experimental) | yes (experimental) | **no** (folded into `MySQL`) | no — remote |
 * | `MaterializedPostgreSQL` | yes (experimental) | yes (experimental) | yes (experimental) | no — remote |
 * | `Dictionary` | yes | yes | yes | no — ClickHouse flags it `is_external = 1`, and a MergeTree table cannot be created in one |
 * | `Overlay` | no | yes | yes | no — a view over other databases, so it can wrap a *remote* one |
 * | `SQLite`, `Filesystem`, `S3`, `HDFS` | yes | yes | yes | no — filesystem-backed catalogs |
 * | `Backup`, `DataLakeCatalog`, `Remote`, `RemoteSecure`, `URL` | no | yes | varies | no — remote |
 *
 * ### Why `Memory` is in the list
 *
 * `Memory` is in-process only: listing its tables is local and as cheap as a
 * `system.tables` scan gets, and it *can* hold MergeTree tables (`CREATE TABLE
 * … ENGINE = MergeTree` inside a `Memory` database is valid and has active
 * parts in `system.parts`). Excluding it would make those parts invisible to
 * the parts-pressure check while buying nothing, so it stays.
 *
 * ### Why `Shared` is in the list even though it could not be verified
 *
 * `Shared` (ClickHouse Cloud shared-nothing) is absent from
 * `system.database_engines` on 24.3 and 26.7 and from `CREATE DATABASE` on all
 * three OSS servers tested — it only ships in Cloud, which is not reachable from
 * here. An engine name that matches nothing costs nothing (the `IN` list simply
 * never matches), while dropping it would hide Cloud's tables from every health
 * check. Kept as the fail-open direction, and flagged here as the one entry in
 * this list backed by documentation rather than measurement.
 */

/**
 * Engines whose tables (and part data) live on the node running the query.
 * Kept sorted; see the module doc for the per-version evidence.
 */
export const LOCAL_DATABASE_ENGINES = [
  'Atomic',
  'Lazy',
  'Memory',
  'Ordinary',
  'Replicated',
  'Shared',
] as const

/**
 * Predicate for a `system.tables` / `system.columns` scan that must only see
 * locally stored tables. Written as a `database IN (...)` sub-select on
 * `system.databases` because that table is pure local metadata, so resolving
 * it is cheap even on a cluster full of remote databases.
 *
 * Apply it to the *outer* table of the scan. Note it does **not** substitute
 * for a filter on `system.parts` / `system.part_log`: those never list a
 * remote-engine database in the first place, so filtering them would only add
 * a sub-select to a scan that is already local.
 */
export const LOCAL_DATABASES_FILTER = `database IN (SELECT name FROM system.databases WHERE engine IN (${LOCAL_DATABASE_ENGINES.map(
  (engine) => `'${engine}'`
).join(', ')}))`

/**
 * True when a built SQL string already restricts `system.tables` /
 * `system.columns` to local databases. Used by the health-query guard test.
 *
 * Matches on the rendered filter text rather than on a symbol name so a
 * query that inlines the predicate by hand still passes.
 */
export function hasLocalDatabasesFilter(sql: string): boolean {
  return /system\.databases\s+WHERE\s+engine\s+IN\s*\(/i.test(sql)
}
