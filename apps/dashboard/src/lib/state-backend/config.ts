/**
 * State-backend env parsing (server-only), shared by the three UI-state
 * stores: connection-store, conversation-store, and dashboard-storage.
 *
 * A self-hosted (OSS) deployment can persist its UI state in the operator's
 * own database instead of Cloudflare D1. Resolution order everywhere is
 * fail-open, OSS-first:
 *
 *   explicit backend override (where one exists) → D1 binding →
 *   ClickHouse state env (`CHM_STATE_CLICKHOUSE_*`) →
 *   Postgres env (`DATABASE_URL` / `POSTGRES_URL`) → local/memory fallback.
 *
 * This module only centralizes the env reads so the stores share one source
 * of truth — it does not talk to any database itself.
 *
 * {@link resolveStateBackend} is the ONE answer to "is there a state backend,
 * and which kind?" — `/api/v1/config`'s `metadataDb.available` derives from it
 * so the flag and the stores can never disagree (#3493).
 */

import { getPlatformBindings } from '@chm/platform'

/** Valid ClickHouse identifier (database name / table prefix). */
const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/

export const DEFAULT_STATE_CLICKHOUSE_DATABASE = 'chmonitor'
export const DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX = 'chm_state_'

export interface StateClickHouseConfig {
  url: string
  user: string
  password: string
  database: string
  tablePrefix: string
}

/**
 * Reads the dedicated state-ClickHouse env. Returns `null` when
 * `CHM_STATE_CLICKHOUSE_URL` is unset (the backend is opt-in).
 *
 * Fail-open: an invalid `database`/`tablePrefix` (would-be SQL-identifier
 * injection into DDL) logs a warning and falls back to the default rather
 * than throwing, so a typo never takes the app down.
 */
export function getStateClickHouseConfig(
  env: Record<string, string | undefined> = process.env
): StateClickHouseConfig | null {
  const url = env.CHM_STATE_CLICKHOUSE_URL?.trim()
  if (!url) return null

  let database =
    env.CHM_STATE_CLICKHOUSE_DATABASE?.trim() ||
    DEFAULT_STATE_CLICKHOUSE_DATABASE
  if (!IDENTIFIER_RE.test(database)) {
    console.warn(
      `[state-backend] Invalid CHM_STATE_CLICKHOUSE_DATABASE "${database}" (must match ${IDENTIFIER_RE}); using "${DEFAULT_STATE_CLICKHOUSE_DATABASE}"`
    )
    database = DEFAULT_STATE_CLICKHOUSE_DATABASE
  }

  let tablePrefix =
    env.CHM_STATE_CLICKHOUSE_TABLE_PREFIX?.trim() ||
    DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX
  if (!IDENTIFIER_RE.test(tablePrefix)) {
    console.warn(
      `[state-backend] Invalid CHM_STATE_CLICKHOUSE_TABLE_PREFIX "${tablePrefix}" (must match ${IDENTIFIER_RE}); using "${DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX}"`
    )
    tablePrefix = DEFAULT_STATE_CLICKHOUSE_TABLE_PREFIX
  }

  return {
    url,
    user: env.CHM_STATE_CLICKHOUSE_USER ?? 'default',
    password: env.CHM_STATE_CLICKHOUSE_PASSWORD ?? '',
    database,
    tablePrefix,
  }
}

/**
 * Postgres state-backend connection string, if configured. Same precedence
 * as the existing connection-store Postgres path.
 */
export function getStatePostgresUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  return (
    env.DATABASE_URL?.trim() ||
    env.POSTGRES_URL?.trim() ||
    env.POSTGRES_PRISMA_URL?.trim() ||
    null
  )
}

/** The D1 binding every state store checks first (Cloud). */
export const STATE_D1_BINDING = 'CHM_CLOUD_D1'

/** Which state backend a deployment resolves to, in precedence order. */
export type StateBackendKind = 'd1' | 'clickhouse' | 'postgres'

/** Probe for a bound D1 database. Injectable so tests need no module mocks. */
export type D1BindingProbe = (bindingName: string) => boolean

/**
 * Default probe: the platform D1 binding. Any throw (not on workerd, no
 * platform context) counts as "not bound" — fail closed.
 */
export const defaultD1BindingProbe: D1BindingProbe = (bindingName) => {
  try {
    return getPlatformBindings().getD1Database(bindingName) !== null
  } catch {
    return false
  }
}

/**
 * Resolve the state backend in the documented order: D1 binding →
 * `CHM_STATE_CLICKHOUSE_*` → `DATABASE_URL` / `POSTGRES_URL` /
 * `POSTGRES_PRISMA_URL`. Returns `null` when none is configured (the caller
 * then falls back to local/memory state, or reports the capability as
 * unavailable). D1 stays first, so Cloud is unchanged.
 */
export function resolveStateBackend(
  env: Record<string, string | undefined> = process.env,
  hasD1: D1BindingProbe = defaultD1BindingProbe
): StateBackendKind | null {
  if (hasD1(STATE_D1_BINDING)) return 'd1'
  if (getStateClickHouseConfig(env)) return 'clickhouse'
  if (getStatePostgresUrl(env)) return 'postgres'
  return null
}

/**
 * `/api/v1/config`'s `metadataDb.available`: true iff a state backend
 * resolves. Kept here (not inlined in the route) so the flag is, by
 * construction, `resolveStateBackend() !== null`.
 */
export function isMetadataDbAvailable(
  env: Record<string, string | undefined> = process.env,
  hasD1: D1BindingProbe = defaultD1BindingProbe
): boolean {
  return resolveStateBackend(env, hasD1) !== null
}
