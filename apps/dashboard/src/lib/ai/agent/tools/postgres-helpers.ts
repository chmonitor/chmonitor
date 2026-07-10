/**
 * Shared helpers for the agent's Postgres tools.
 *
 * These tools resolve a `pgHostId` against the env-based `POSTGRES_*` lists
 * (see `@chm/postgres-client`'s `getPostgresConfigs`) and execute through the
 * ONE read-only Postgres query path Phase 2 built (`queryPostgres`): a
 * per-request connect that pins `default_transaction_read_only=on`, gates the
 * SQL to a single SELECT/WITH/SHOW/EXPLAIN/TABLE/VALUES statement, and always
 * uses the extended protocol (rejecting multi-statement strings at the wire).
 *
 * SSRF note: env-configured Postgres hosts are OPERATOR-supplied config, the
 * exact trust level as `CLICKHOUSE_HOST`. The ClickHouse agent path
 * (`getClickHouseConfigs` → `fetchData`) does NOT SSRF-guard its env hosts —
 * `validatePostgresHost` guards only browser/user-supplied connections in the
 * connection routes. We MATCH that precedent here and do not re-guard env
 * hosts; the guard would otherwise block loopback/LAN operators point at
 * on purpose.
 */

import { z } from 'zod'

import {
  formatPostgresError,
  getAndValidatePostgresConfig,
  queryPostgres,
} from '@chm/postgres-client'

/**
 * Required per-call `pgHostId` — a flat positional index into the `POSTGRES_*`
 * env lists. Unlike the ClickHouse `hostId` (which defaults to 0), the Postgres
 * tools have no ambient default host, so this is required. Null / empty-string
 * are normalized to `undefined` so they fail validation loudly instead of
 * silently coercing to source 0.
 */
export const pgHostIdSchema = z
  .preprocess((val) => {
    if (val === null || val === undefined) return undefined
    if (typeof val === 'string' && val.trim() === '') return undefined
    return val
  }, z.coerce.number().int().nonnegative())
  .describe('Postgres source id (index into the POSTGRES_* env lists)')

/**
 * Resolve `pgHostId` → env config and run ONE read-only statement through the
 * shared Phase-2 query path. Returns the rows and field metadata `pg` reports.
 *
 * Throws for an unconfigured / out-of-range `pgHostId` or a rejected (non
 * read-only / multi-) statement; connection/driver errors are normalized with
 * their SQLSTATE via {@link formatPostgresError} so the model gets an
 * actionable message.
 */
export async function runPostgresReadOnly<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  pgHostId: number,
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<{ rows: T[]; fields: { name: string; dataTypeID: number }[] }> {
  const config = getAndValidatePostgresConfig(pgHostId)
  try {
    return await queryPostgres<T>(config, sql, params)
  } catch (err) {
    throw new Error(formatPostgresError(err))
  }
}
