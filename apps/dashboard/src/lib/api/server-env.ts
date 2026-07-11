/**
 * Server env bridge for ClickHouse access on Cloudflare Workers.
 *
 * `@chm/clickhouse-client` resolves host config from `process.env.CLICKHOUSE_*`
 * (see packages/clickhouse-client/.../env-schema.ts — it reads `process.env`
 * directly and caches the result). In the Next dashboard those vars are present
 * on `process.env` ambiently. In this TanStack Start / Workers app the canonical
 * source is the Worker binding (`import { env } from 'cloudflare:workers'`), so
 * we must copy the CLICKHOUSE_* values onto `process.env` before the first
 * query — otherwise the client sees no hosts.
 *
 * Call `bridgeClickHouseEnv(env)` at the top of every CH-querying route handler,
 * passing the Worker `env` binding. It is idempotent and cheap.
 *
 * NOTE: the client caches the parsed env after first read. The bridge runs
 * before any client call within a request, and Worker isolates are short-lived,
 * so the cache reflects the bound values. If you ever rotate a secret you must
 * redeploy (same constraint as the Next app — see secret-rotation knowledge).
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

/**
 * Copy CLICKHOUSE_* values from the Worker `env` binding onto `process.env`
 * so `@chm/clickhouse-client` can read them. Only sets keys that are present
 * on the binding and not already set, to avoid clobbering a local `.dev.vars`
 * / process env during `vite dev` on node.
 */
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

/**
 * Copy the Postgres feature flag + `POSTGRES_*` connection lists from the Worker
 * `env` binding onto `process.env` so the env-based Postgres source resolver
 * (`getPostgresConfigs`) and the `CHM_FEATURE_POSTGRES_SOURCE` gate see them.
 * Idempotent and cheap; only sets keys present on the binding and not already
 * set, so it never clobbers a local `.dev.vars` during `vite dev`.
 */
export function bridgePostgresEnv(bindings: ClickHouseBindings): void {
  if (typeof process === 'undefined' || !process.env) return
  for (const key of POSTGRES_ENV_KEYS) {
    const value = bindings[key]
    if (value != null && value !== '' && process.env[key] == null) {
      process.env[key] = value
    }
  }
}
