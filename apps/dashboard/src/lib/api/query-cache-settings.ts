/**
 * ClickHouse query-cache settings for read-only polling queries (#2182).
 *
 * Every chart/table/count poll on `/api/v1/charts`, `/api/v1/tables`,
 * `/api/v1/menu-counts`, and `/api/v1/host-status` re-runs a full
 * `system.*` scan from scratch, even though nothing changed since the last
 * poll a few seconds ago. On the shared public demo host, every concurrent
 * anonymous viewer re-executes the same scan independently. Turning on
 * ClickHouse's server-side query cache for these GET/read paths lets
 * concurrent/repeat pollers hit the cache instead of re-scanning, bounded by
 * a TTL that mirrors the page's own poll interval — so the worst case is
 * data that is already as stale as the existing poll cadence tolerates.
 *
 * SCOPE: only apply `buildQueryCacheSettings` output to read-only GET query
 * paths. Never apply it to agent/control-tool queries or any mutating query
 * — the query cache only affects SELECTs, but staleness on a query an admin
 * just ran to verify a mutation would be actively misleading.
 *
 * Version gating is mandatory: `use_query_cache` does not exist before
 * ClickHouse 23.5, and sending an unrecognized setting name to ClickHouse
 * throws "Unknown setting" and fails the ENTIRE query — worse than the
 * staleness this feature is meant to trade for. This dashboard supports
 * ClickHouse hosts back to 19.x (see `since` fields across
 * `lib/query-config/**`), so this is not a theoretical concern; an unknown
 * or undetectable version fails closed (no cache settings applied).
 *
 * Most system.* monitoring queries use now()/today(), which the query cache
 * treats as non-deterministic. Since ClickHouse 24.2
 * (https://github.com/ClickHouse/ClickHouse/pull/56519), the default
 * handling for such queries is `query_cache_nondeterministic_function_handling
 * = 'throw'`, which makes the query FAIL outright once `use_query_cache=1`
 * is set — so `'save'` here is not an optimization, it is required for
 * correctness. Pre-24.2 hosts don't have that setting; they use the older
 * boolean equivalent (`query_cache_store_results_of_queries_with_nondeterministic_functions`),
 * whose default (`false`) is safe (silently skips caching, never throws), so
 * it is set explicitly for parity on those hosts too.
 *
 * Similarly, essentially EVERY dashboard query reads a `system.*` table. Since
 * ClickHouse 24.4 (https://github.com/ClickHouse/ClickHouse/pull/62376), the
 * query cache refuses to cache any query that touches a system table, and the
 * default `query_cache_system_table_handling = 'throw'` makes the query FAIL
 * with error 719 (`QUERY_CACHE_USED_WITH_SYSTEM_TABLE`) the moment
 * `use_query_cache=1` is set — e.g. the Running Queries page's
 * `system.processes` scan returned no rows on ClickHouse 26.3 for exactly this
 * reason. `'save'` is required for correctness here too (cache the result,
 * bounded by the same short TTL). Pre-24.4 hosts don't have that setting and
 * simply skip caching system-table queries without throwing, so it is omitted
 * there — sending an unknown setting name would itself fail the query.
 *
 * ASSUMPTION (flagged per the #2182 review request): whether the demo
 * ClickHouse host has the *server-side* query cache enabled/sized
 * (`query_cache_max_size_in_bytes` / config-level toggle, as opposed to the
 * per-query opt-in below) is not recorded anywhere in this repo's
 * docs/knowledge or env config, and was not independently verifiable from
 * the codebase. `use_query_cache: 1` is the client-side opt-in ClickHouse
 * requires regardless of server config; if the server-side cache is disabled
 * or zero-sized, this setting is a no-op (queries just execute normally,
 * without the cache benefit) rather than an error.
 */

import type { ClickHouseSettings } from '@clickhouse/client'

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

import { meetsMinVersion } from '@chm/clickhouse-client/clickhouse-version'
import { warn } from '@chm/logger'

/** ClickHouse added the query cache (`use_query_cache`) in 23.5. */
const MIN_QUERY_CACHE_VERSION = { major: 23, minor: 5 } as const

/** `query_cache_nondeterministic_function_handling` enum landed in 24.2. */
const MIN_NONDETERMINISTIC_ENUM_VERSION = { major: 24, minor: 2 } as const

/**
 * `query_cache_system_table_handling` (and the default-`throw` rejection of
 * caching system-table queries, error 719) landed in ClickHouse 24.4
 * (PR #62376).
 */
const MIN_SYSTEM_TABLE_HANDLING_VERSION = { major: 24, minor: 4 } as const

export interface QueryCacheSettingsOptions {
  /** Detected ClickHouse version for the target host, or null if unknown. */
  version: ClickHouseVersion | null
  /** TTL in seconds bounding cache staleness — mirror the poll/refresh cadence. */
  ttlSeconds: number
  /** Per-query-config opt-out. */
  disabled?: boolean
}

/**
 * Build `clickhouse_settings` that turn on the ClickHouse query cache for a
 * read-only query, or `{}` when disabled, the TTL is non-positive, or the
 * host's ClickHouse version can't be confirmed to support it.
 */
export function buildQueryCacheSettings({
  version,
  ttlSeconds,
  disabled,
}: QueryCacheSettingsOptions): ClickHouseSettings {
  if (disabled || ttlSeconds <= 0) return {}
  // Fail closed: an undetectable version might predate use_query_cache
  // (23.5), and sending it would error the whole query.
  if (!version) return {}
  if (
    !meetsMinVersion(
      version,
      MIN_QUERY_CACHE_VERSION.major,
      MIN_QUERY_CACHE_VERSION.minor
    )
  ) {
    return {}
  }

  // NOTE: do NOT add a bare `overflow_mode` setting here — no such setting
  // exists in ANY ClickHouse version (only `result_overflow_mode`,
  // `timeout_overflow_mode`, etc.), and an unknown setting name fails the
  // entire query with "Setting overflow_mode is neither a builtin setting…".
  // Error 731 (QUERY_CACHE_USED_WITH_NON_THROW_OVERFLOW_MODE) is instead
  // handled by the callers, which skip the query cache whenever a non-'throw'
  // `result_overflow_mode` is in effect (see query-executor.ts).
  const settings: ClickHouseSettings = {
    use_query_cache: 1,
    query_cache_ttl: ttlSeconds,
  }

  if (
    meetsMinVersion(
      version,
      MIN_NONDETERMINISTIC_ENUM_VERSION.major,
      MIN_NONDETERMINISTIC_ENUM_VERSION.minor
    )
  ) {
    settings.query_cache_nondeterministic_function_handling = 'save'
  } else {
    settings.query_cache_store_results_of_queries_with_nondeterministic_functions = 1
  }

  // ClickHouse 24.4+ rejects caching queries that read system tables unless
  // told otherwise (error 719). Almost every dashboard query reads system.*,
  // so without this the query cache fails those queries outright rather than
  // just skipping the cache. Pre-24.4 hosts don't have the setting and skip
  // caching system-table queries silently, so it is left unset there.
  if (
    meetsMinVersion(
      version,
      MIN_SYSTEM_TABLE_HANDLING_VERSION.major,
      MIN_SYSTEM_TABLE_HANDLING_VERSION.minor
    )
  ) {
    settings.query_cache_system_table_handling = 'save'
  }

  return settings
}

/**
 * Detect ClickHouse's UNKNOWN_SETTING rejection (error code 115). The message
 * wording varies across versions:
 * - "Unknown setting 'use_query_cache'" (older servers)
 * - "Setting x is neither a builtin setting nor started with the prefix
 *   'SQL_' registered for user-defined settings" (newer servers)
 * Accepts a thrown Error or a `FetchDataResult['error']`-shaped object.
 */
export function isUnknownSettingError(err: unknown): boolean {
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message ?? '')
      : ''
  if (!message) return false
  return (
    /unknown setting/i.test(message) ||
    /neither a builtin setting/i.test(message) ||
    /\bCode:\s*115\b/.test(message)
  )
}

const UNKNOWN_SETTING_RETRY_WARNING =
  '[query-cache] host rejected a query-cache setting as unknown; retrying without cache settings'

/**
 * Hosts that rejected the cache settings, so subsequent polls skip sending
 * them instead of paying a failed query + retry on EVERY poll. Mirrors the
 * 24h TTL of the per-host version cache that produced the wrong settings.
 */
const rejectedHosts = new Map<string, number>()
const REJECTION_TTL_MS = 24 * 60 * 60 * 1000

/** Test-only: forget remembered per-host rejections. */
export function clearUnknownSettingRejections(): void {
  rejectedHosts.clear()
}

/**
 * Any-ClickHouse-version safety net: the query cache is an optimization, so
 * its settings must NEVER fail a query. Version gating above handles the
 * versions we know about, but a host outside the tested matrix (very old,
 * very new, or a fork) may still reject a setting name as unknown — in that
 * case, retry ONCE without the cache settings instead of surfacing the
 * error, and remember the rejection per host so later polls skip the wasted
 * round-trip.
 *
 * Errors are detected on both conventions: a thrown error (raw client calls)
 * and a `result.error` field (`fetchData`-shaped results).
 */
export async function withUnknownSettingRetry<T>(
  cacheSettings: ClickHouseSettings,
  run: (settings: ClickHouseSettings) => Promise<T>,
  hostId?: number | string
): Promise<T> {
  if (Object.keys(cacheSettings).length === 0) return run(cacheSettings)

  const hostKey = hostId === undefined ? undefined : String(hostId)
  if (hostKey !== undefined) {
    const expiry = rejectedHosts.get(hostKey)
    if (expiry !== undefined && expiry > Date.now()) return run({})
    if (expiry !== undefined) rejectedHosts.delete(hostKey)
  }

  let result: T | undefined
  let resolved = false
  let err: unknown
  try {
    result = await run(cacheSettings)
    resolved = true
    err = (result as { error?: unknown } | null | undefined)?.error
  } catch (thrown) {
    if (!isUnknownSettingError(thrown)) throw thrown
    err = thrown
  }
  if (resolved && !isUnknownSettingError(err)) return result as T

  warn(UNKNOWN_SETTING_RETRY_WARNING, err)
  if (hostKey !== undefined) {
    rejectedHosts.set(hostKey, Date.now() + REJECTION_TTL_MS)
  }
  return run({})
}

/**
 * The one entry point call sites should use: build the version-gated cache
 * settings AND run the query under the unknown-setting safety net in a single
 * step, so no future caller can obtain cache settings without the retry
 * protection. `hostId` keys the per-host rejection memo.
 */
export async function runWithQueryCache<T>(
  opts: QueryCacheSettingsOptions & { hostId: number | string },
  run: (settings: ClickHouseSettings) => Promise<T>
): Promise<T> {
  return withUnknownSettingRetry(
    buildQueryCacheSettings(opts),
    run,
    opts.hostId
  )
}
