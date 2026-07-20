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
 */

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
