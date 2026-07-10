/**
 * @chm/postgres-client — Postgres source types.
 *
 * Phase 1 (types-only) sibling to `@chm/clickhouse-client`. This package holds
 * the Postgres connection SHAPE and id-space convention; it deliberately pulls
 * in NO Postgres driver yet (the `cloudflare:sockets` raw-TCP driver lands in
 * Phase 2, #2449). Keeping Postgres types out of `@chm/clickhouse-client` keeps
 * the ClickHouse package from growing an unrelated engine.
 *
 * The `SourceEngine` discriminator is re-exported from `@chm/types` so callers
 * can reach it through either package.
 */

export type { SourceEngine } from '@chm/types'

export {
  DEFAULT_SOURCE_ENGINE,
  isSourceEngine,
  parseSourceEngine,
  SOURCE_ENGINES,
} from '@chm/types'

/**
 * A Postgres source's connection config — the sibling of
 * `ClickHouseConfig` in `@chm/clickhouse-client`.
 *
 * `id` is a `pgHostId` (see the id-space note below), a SEPARATE flat index
 * from ClickHouse's `hostId` — never reuse a ClickHouse `hostId` here.
 */
export type PostgresConfig = {
  /** `pgHostId` — flat positional index in the Postgres id space (see below). */
  id: number
  host: string
  port: number
  user: string
  password: string
  database: string
  /** libpq `sslmode` (e.g. `require`, `verify-full`); omitted = driver default. */
  sslmode?: string
  /** Operator-supplied display name, mirrors `ClickHouseConfig.customName`. */
  customName?: string
}

/**
 * **`pgHostId` id-space convention.**
 *
 * ClickHouse hosts are addressed by a flat positional index `hostId: number`
 * (index into the comma-separated `CLICKHOUSE_*` env lists, threaded through
 * `?host=0`, `fetchDataWithHost`, and every agent tool). That id space means
 * "a ClickHouse host" by convention in ~60 pages and 15 agent tool modules.
 *
 * Postgres sources use their OWN parallel flat index, `pgHostId: number`,
 * rather than a union on the existing `hostId`. This keeps the two engines'
 * addressing disjoint: a `pgHostId` is never a valid `hostId` and vice-versa,
 * so ClickHouse code can never silently resolve a Postgres source (a
 * correctness bug the RFC calls out). Routing that carries a Postgres source
 * pairs `pgHostId` with `engine: 'postgres'` — never overloads `hostId`.
 *
 * @see SourceEngine
 */
export type PgHostId = number
