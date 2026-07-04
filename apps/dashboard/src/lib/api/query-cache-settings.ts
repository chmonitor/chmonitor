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

/** ClickHouse added the query cache (`use_query_cache`) in 23.5. */
const MIN_QUERY_CACHE_VERSION = { major: 23, minor: 5 } as const

/** `query_cache_nondeterministic_function_handling` enum landed in 24.2. */
const MIN_NONDETERMINISTIC_ENUM_VERSION = { major: 24, minor: 2 } as const

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

  return settings
}
