/**
 * The central rule for ClickHouse read-only mode (issue #3680).
 *
 * ClickHouse's `readonly` setting has three levels:
 *
 * - `0` — read, write and change-settings queries are allowed.
 * - `1` — only read queries, AND no other setting may be changed. A per-query
 *   setting sent in the same request is rejected with
 *   `Code: 164 Cannot modify '<setting>' setting in readonly mode` and the query
 *   never runs.
 * - `2` — only read queries, but settings OTHER THAN `readonly` itself may be
 *   changed. Writes and DDL stay blocked.
 *
 * chmonitor needs both halves at once: every request carries
 * `max_execution_time` (from `CLICKHOUSE_MAX_EXECUTION_TIME`), several call sites
 * additionally ask for read-only mode, and some SQL carries its own
 * `SETTINGS max_execution_time = …` clause. At level 1 the whole request is
 * refused, which is why the TTL / partition health check never ran (5-18 times
 * per node per day, in all 3 regions).
 *
 * So the rule enforced here, in ONE place: a request that asks for read-only
 * mode is sent at level 2.
 *
 * Level 2 is NOT a weaker guarantee for our purpose. Verified against live
 * ClickHouse 26.7 and 24.3 (see `scripts/verify-readonly-mode.ts`): at level 2
 * `INSERT`, `CREATE TABLE`, `ALTER`, `DROP TABLE` and `CREATE DATABASE` are all
 * still refused with Code 164, and `SETTINGS readonly = 0` is refused with
 * `Cannot modify 'readonly' setting in readonly mode`.
 *
 * Call sites keep writing `readonly: '1'`: that is what they mean, and this
 * module upgrades it on the way out. Nothing at a call site can bypass the rule
 * because the wrapper is applied to the pooled client inside `getClient()` —
 * every `query()`/`command()` goes through it regardless of what the caller
 * passed.
 */

import type { ClickHouseClient } from '@clickhouse/client'
import type { ClickHouseClient as WebClickHouseClient } from '@clickhouse/client-web'

/** The read-only level chmonitor sends. See the module docblock. */
export const READONLY_MODE = 2

/**
 * Rewrite `readonly: 1` (or `'1'`) to {@link READONLY_MODE}.
 *
 * Returns the same object when there is nothing to change, so the common
 * no-readonly case costs one property read. Never mutates its input.
 */
export function normalizeReadonlySettings<
  T extends Record<string, unknown> | undefined,
>(settings: T): T {
  if (!settings) return settings

  const mode = settings.readonly
  if (mode === 1 || mode === '1') {
    return { ...settings, readonly: READONLY_MODE }
  }
  return settings
}

type WithSettings = { clickhouse_settings?: Record<string, unknown> }

/**
 * The two request-carrying methods that take `clickhouse_settings`. `insert` and
 * `exec` are deliberately not wrapped: they are writes, and read-only mode
 * refuses them at level 1 and level 2 alike, so there is nothing to reconcile.
 */
type RequestMethods = {
  query?: (params: unknown) => unknown
  command?: (params: unknown) => unknown
}

/**
 * Wrap a ClickHouse client so `readonly` is normalized on every request.
 *
 * Deliberately mutates the client in place rather than returning a wrapper
 * object: `getClient()` hands this same instance to callers, the connection
 * pool, and `releaseClient()`, so returning a different object would split
 * identity across those three. Shading `query`/`command` with own properties
 * keeps the instance identical and is invisible to everything except settings.
 */
export function withReadonlyEnforcement<
  T extends ClickHouseClient | WebClickHouseClient,
>(client: T): T {
  const normalize = (params: unknown): unknown => {
    if (params === null || typeof params !== 'object') return params

    const settings = (params as WithSettings).clickhouse_settings
    if (!settings) return params

    const normalized = normalizeReadonlySettings(settings)
    return normalized === settings
      ? params
      : { ...(params as WithSettings), clickhouse_settings: normalized }
  }

  const target = client as unknown as RequestMethods
  const query = target.query
  if (typeof query === 'function') {
    target.query = (params: unknown) => query.call(client, normalize(params))
  }

  const command = target.command
  if (typeof command === 'function') {
    target.command = (params: unknown) =>
      command.call(client, normalize(params))
  }

  return client
}
