/**
 * Server-side Postgres query executor for the Postgres pages (issue #2450).
 *
 * REUSES the Phase 2 read-only query path (`@chm/postgres-client.queryPostgres`)
 * — per-request connect, session pinned read-only, single-SELECT gate, extended
 * protocol — rather than opening a second Postgres access path. Every call
 * re-runs the TCP SSRF guard (`validatePostgresHost`), matching the ClickHouse
 * connection path's posture, because the host comes from user-supplied
 * connection credentials.
 */

import type { ConnectionCredentials } from '@/lib/connection-store/types'

import {
  type PostgresConnectionConfig,
  queryPostgres,
} from '@chm/postgres-client'
import { validatePostgresHost } from '@/lib/browser-connections/host-url'

/** Default Postgres TCP port when a connection omits one. */
const DEFAULT_PG_PORT = 5432
/** Default database when a connection omits one. */
const DEFAULT_PG_DATABASE = 'postgres'

/**
 * Map decrypted connection credentials (v2 envelope, `kind: 'postgres'`) to the
 * `@chm/postgres-client` connection config. For Postgres the stored `host` is a
 * BARE hostname/IP (no scheme) and the endpoint is `host:port`.
 */
export function credentialsToPgConfig(
  credentials: ConnectionCredentials
): PostgresConnectionConfig {
  return {
    host: credentials.host,
    port: credentials.port ?? DEFAULT_PG_PORT,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database ?? DEFAULT_PG_DATABASE,
    sslmode: credentials.sslmode,
  }
}

/** Guard the target, then fail loud with the SSRF/validation reason. */
async function assertHostAllowed(
  config: PostgresConnectionConfig
): Promise<void> {
  const reason = await validatePostgresHost(config.host, config.port)
  if (reason) {
    throw new Error(reason)
  }
}

/**
 * Whether a Postgres extension is installed on the target database. Used as the
 * Postgres analog of the ClickHouse `tableCheck` — drives the graceful
 * "extension not installed" empty state instead of surfacing a raw error.
 */
export async function isPgExtensionInstalled(
  config: PostgresConnectionConfig,
  extname: string
): Promise<boolean> {
  const { rows } = await queryPostgres<{ ok: number }>(
    config,
    'SELECT 1 AS ok FROM pg_extension WHERE extname = $1',
    [extname]
  )
  return rows.length > 0
}

export interface PgQueryResult {
  data: Record<string, unknown>[]
  metadata: { duration: number; rows: number }
}

/**
 * Run a single read-only Postgres statement and return its rows plus timing
 * metadata. Re-guards the host before connecting.
 */
export async function executePgQuery(
  config: PostgresConnectionConfig,
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<PgQueryResult> {
  await assertHostAllowed(config)
  const start = Date.now()
  const { rows } = await queryPostgres(config, sql, params)
  return {
    data: rows,
    metadata: { duration: Date.now() - start, rows: rows.length },
  }
}
