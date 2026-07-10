/**
 * Postgres runtime client — the read-only query path for Postgres sources.
 *
 * Phase 2 (#2449) landed the connectivity decision: the standard `pg` driver
 * runs in BOTH runtimes off ONE code path. In the Cloudflare Workers runtime
 * `pg` (>=8.11) auto-selects its `pg-cloudflare` (`cloudflare:sockets` raw TCP)
 * transport under `nodejs_compat`; on Node it uses `net.Socket`. So self-hosted
 * (Docker/K8s, real Node) and Cloud (Worker) share this module with full parity
 * — no second driver, no Hyperdrive binding (see the POC evidence on #2449).
 *
 * Safety posture — this is a MONITORING client, never a write path:
 *   1. Every session is pinned read-only (`SET default_transaction_read_only`),
 *      so Postgres itself rejects any write even if a statement slips the gate.
 *   2. `assertReadOnlyStatement` gates the SQL to a single SELECT/WITH/SHOW/
 *      EXPLAIN/TABLE/VALUES statement before it is ever sent.
 *   3. Queries always run through the extended protocol (a `values` array is
 *      always passed), which rejects multi-statement strings at the wire level.
 *   4. Tight `connectionTimeoutMillis` + `statement_timeout` bound every call.
 */

import { Client, type ClientConfig } from 'pg'

/** Connection parameters for a Postgres source (a subset of `PostgresConfig`). */
export interface PostgresConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  /** libpq-style `sslmode`; omitted / unknown falls back to `require`. */
  sslmode?: string
}

/** How long to wait for the TCP connect + auth handshake before failing. */
const CONNECT_TIMEOUT_MS = 8_000
/** Server-side per-statement cap (ms), pushed via `statement_timeout`. */
const STATEMENT_TIMEOUT_MS = 15_000

/**
 * Map a libpq `sslmode` to node-postgres `ssl` options.
 *
 * - `disable`               → no TLS.
 * - `require`  (default)    → TLS, but the certificate is NOT verified
 *                             (matches libpq `require`, which only encrypts).
 * - `verify-ca`/`verify-full` → TLS with certificate verification.
 * - `prefer`/`allow`        → treated as `require` (we never downgrade to
 *                             plaintext opportunistically in a hosted service).
 *
 * Returns `pg`'s `ssl` field (`false` or a `ConnectionOptions`-shaped object).
 */
export function sslOptionsForMode(sslmode?: string): ClientConfig['ssl'] {
  switch ((sslmode ?? 'require').toLowerCase()) {
    case 'disable':
      return false
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true }
    default:
      // require / prefer / allow / unknown → encrypt without cert verification.
      return { rejectUnauthorized: false }
  }
}

const READ_ONLY_LEADING = /^(select|with|show|explain|table|values)\b/i

/**
 * Reject anything that isn't a single read-only statement.
 *
 * Defense-in-depth on top of the session's read-only transaction: catches
 * writes early with a clear message and blocks multi-statement injection. The
 * authoritative guard is still `default_transaction_read_only = on`.
 *
 * @throws Error when the SQL is multi-statement or not obviously read-only.
 */
export function assertReadOnlyStatement(sql: string): void {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (trimmed.length === 0) {
    throw new Error('Empty SQL statement')
  }
  // A remaining `;` means more than one statement was supplied.
  if (trimmed.includes(';')) {
    throw new Error('Only a single SQL statement is allowed')
  }
  if (!READ_ONLY_LEADING.test(trimmed)) {
    throw new Error(
      'Only read-only statements are allowed (SELECT, WITH, SHOW, EXPLAIN, TABLE, VALUES)'
    )
  }
}

/**
 * Build (but do not connect) a `pg` client for a Postgres source.
 *
 * Callers own the lifecycle: `await client.connect()` then `client.end()` in a
 * `finally`. Prefer {@link queryPostgres} for the common one-shot read.
 */
export function createPostgresClient(config: PostgresConnectionConfig): Client {
  return new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: sslOptionsForMode(config.sslmode),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // Never fall back to a Unix socket or env-derived host — we only ever want
    // the explicit, SSRF-validated TCP target.
    statement_timeout: STATEMENT_TIMEOUT_MS,
  })
}

/**
 * Connect, pin the session read-only, run ONE read-only statement, disconnect.
 *
 * @param config  Validated Postgres connection parameters.
 * @param sql     A single read-only statement (see {@link assertReadOnlyStatement}).
 * @param params  Optional bind params; the extended protocol is always used.
 * @returns The result rows plus the field metadata `pg` reports.
 */
export async function queryPostgres<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  config: PostgresConnectionConfig,
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<{ rows: T[]; fields: { name: string; dataTypeID: number }[] }> {
  assertReadOnlyStatement(sql)

  const client = createPostgresClient(config)
  try {
    await client.connect()
    // Pin the whole session read-only so Postgres rejects any write server-side.
    await client.query('SET default_transaction_read_only = on')
    // Always pass a values array → extended (single-statement) protocol.
    const result = await client.query({
      text: sql,
      values: (params ?? []) as unknown[],
    })
    return {
      rows: result.rows as T[],
      fields: result.fields.map((f) => ({
        name: f.name,
        dataTypeID: f.dataTypeID,
      })),
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

/**
 * Normalize a thrown `pg` error into a classifier-friendly string.
 *
 * The connection-error classifier (`lib/connection-errors.ts`) is purely
 * string-based, but `pg`'s most reliable signal is the SQLSTATE on `err.code`
 * (`28P01`, `3D000`, `08006`, …) or a Node network code (`ECONNREFUSED`, …).
 * Appending the code makes classification robust regardless of message wording.
 */
export function formatPostgresError(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown } | null | undefined
  const msg =
    e && typeof e.message === 'string' && e.message.trim().length > 0
      ? e.message
      : 'Postgres connection failed'
  const code = e && typeof e.code === 'string' ? e.code : undefined
  return code ? `${msg} [${code}]` : msg
}

/**
 * One-shot connectivity probe: connect and read the server version.
 *
 * Mirrors the ClickHouse `SELECT version()` test path. Returns the version
 * string on success; throws the raw driver error on failure so the caller can
 * classify it (see `lib/connection-errors.ts`).
 */
export async function getPostgresVersion(
  config: PostgresConnectionConfig
): Promise<string> {
  const { rows } = await queryPostgres<{ version: string }>(
    config,
    'SELECT version() AS version'
  )
  return rows[0]?.version ?? ''
}
