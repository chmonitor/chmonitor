/**
 * `@chm/clickhouse-client` reads `process.env.CLICKHOUSE_*` directly and caches the result, but on
 * Workers the canonical source is the `env` binding. Call `bridgeClickHouseEnv(env)` at the top of
 * every CH-querying route handler. Rotating a secret needs a redeploy because of that cache.
 */

const CLICKHOUSE_ENV_KEYS = [
  'CLICKHOUSE_HOST',
  'CLICKHOUSE_USER',
  'CLICKHOUSE_PASSWORD',
  'CLICKHOUSE_NAME',
  'CLICKHOUSE_MAX_EXECUTION_TIME',
  'CLICKHOUSE_DATABASE',
  'EVENTS_TABLE_NAME',
] as const

export type ClickHouseBindings = Record<string, string | undefined>

// Only sets keys not already set, so a local `.dev.vars` / process env is never clobbered.
export function bridgeClickHouseEnv(bindings: ClickHouseBindings): void {
  if (typeof process === 'undefined' || !process.env) return
  for (const key of CLICKHOUSE_ENV_KEYS) {
    const value = bindings[key]
    if (value != null && value !== '' && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

/**
 * Env keys the Postgres source path reads from `process.env`: the feature gate
 * (`CHM_FEATURE_POSTGRES_SOURCE`) plus the `POSTGRES_*` connection lists that
 * `@chm/postgres-client`'s `getPostgresConfigs()` parses. Same bridging need as
 * ClickHouse — on Workers the canonical source is the `env` binding, so these
 * must be copied onto `process.env` before `getPostgresConfigs()` is called.
 */
const POSTGRES_ENV_KEYS = [
  'CHM_FEATURE_POSTGRES_SOURCE',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_SSLMODE',
  'POSTGRES_NAME',
] as const

export function bridgePostgresEnv(bindings: ClickHouseBindings): void {
  if (typeof process === 'undefined' || !process.env) return
  for (const key of POSTGRES_ENV_KEYS) {
    const value = bindings[key]
    if (value != null && value !== '' && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

/**
 * Env keys the PeerDB alert/insight path reads from `process.env`: the
 * flow-api base URL plus auth. The timeout/cache tunables and the alert-sweep
 * fan-out bounds (`PEERDB_SWEEP_CONCURRENCY`/`PEERDB_SWEEP_BUDGET_MS`, #3677,
 * plus the optional coverage guard `PEERDB_SWEEP_MAX_MIRRORS`, #3687)
 * are ALSO bridged, but consumers must read them lazily per request/call (Workers
 * bindings are per-request state — a module-scope read would pin the first
 * isolate's values). Same bridging need as ClickHouse/Postgres — on Workers
 * the canonical source is the `env` binding, so these must be copied onto
 * `process.env` before the PeerDB collectors run. Idempotent and cheap; never
 * clobbers local dev vars.
 */
const PEERDB_ENV_KEYS = [
  'PEERDB_API_URL',
  'PEERDB_PASSWORD',
  'PEERDB_AUTH_SCHEME',
  'PEERDB_CACHE_TTL_MS',
  'PEERDB_CACHE_MAX_ENTRIES',
  'PEERDB_FETCH_TIMEOUT_MS',
  'PEERDB_SWEEP_CONCURRENCY',
  'PEERDB_SWEEP_BUDGET_MS',
  'PEERDB_SWEEP_MAX_MIRRORS',
] as const

export function bridgePeerDBEnv(bindings: ClickHouseBindings): void {
  if (typeof process === 'undefined' || !process.env) return
  for (const key of PEERDB_ENV_KEYS) {
    const value = bindings[key]
    if (value != null && value !== '' && process.env[key] == null) {
      process.env[key] = value
    }
  }
}
