/**
 * Data-source engine dimension.
 *
 * Orthogonal to a host's *storage-origin* (`env` / `demo` / `browser` /
 * `database` — where the credentials live). `SourceEngine` says WHAT kind of
 * database the host is, so the same storage-origin can hold a ClickHouse,
 * ClickHouse Cloud, or Postgres source.
 *
 * - `clickhouse`        — self-managed ClickHouse (the historical default).
 * - `clickhouse-cloud`  — ClickHouse Cloud (same wire protocol, different
 *                          badge/menu affordances and future cloud-only pages).
 * - `postgres`          — Postgres source (fail-closed behind
 *                          `CHM_FEATURE_POSTGRES_SOURCE`).
 *
 * Fail-closed: every reader defaults to `'clickhouse'`, so unset/legacy rows
 * and env/demo/browser hosts never lose their existing ClickHouse behaviour.
 */
export type SourceEngine = 'clickhouse' | 'clickhouse-cloud' | 'postgres'

/** All valid engines, in display order. */
export const SOURCE_ENGINES: readonly SourceEngine[] = [
  'clickhouse',
  'clickhouse-cloud',
  'postgres',
] as const

/** The fail-closed default engine for legacy rows and non-Postgres hosts. */
export const DEFAULT_SOURCE_ENGINE: SourceEngine = 'clickhouse'

/** Runtime guard: is `value` one of the known engines? */
export function isSourceEngine(value: unknown): value is SourceEngine {
  return (
    typeof value === 'string' &&
    (SOURCE_ENGINES as readonly string[]).includes(value)
  )
}

/**
 * Coerce an unknown/legacy value to a `SourceEngine`, defaulting to
 * `'clickhouse'`. Use when reading a stored column that may be null/absent on
 * pre-migration rows.
 */
export function parseSourceEngine(value: unknown): SourceEngine {
  return isSourceEngine(value) ? value : DEFAULT_SOURCE_ENGINE
}
