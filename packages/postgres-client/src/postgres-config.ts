/**
 * Postgres source configuration — the env-based `pgHostId` resolver.
 *
 * The sibling of `@chm/clickhouse-client`'s `clickhouse-config.ts`. A
 * `pgHostId` is a flat positional index into the comma-separated `POSTGRES_*`
 * env lists (see the `PgHostId` note in `./index`), exactly the way a
 * ClickHouse `hostId` indexes the `CLICKHOUSE_*` lists. This is the id space the
 * agent's Postgres tools resolve against: operator-supplied, no per-user store,
 * no Clerk — so self-hosted (OSS) has equal Postgres support.
 *
 * Everything here is inert unless `CHM_FEATURE_POSTGRES_SOURCE=true` gates the
 * tools on; an unset `POSTGRES_HOST` simply yields an empty config list.
 */

import type { PostgresConnectionConfig } from './client'

/** A resolved Postgres source: connection params + its id and display name. */
export interface PostgresSourceConfig extends PostgresConnectionConfig {
  /** `pgHostId` — flat positional index into the `POSTGRES_*` env lists. */
  id: number
  /** Operator-supplied display name (`POSTGRES_NAME`), if any. */
  customName?: string
}

/** Default Postgres TCP port when neither an inline `host:port` nor list gives one. */
const DEFAULT_PG_PORT = 5432

function splitByComma(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Split a host entry into `host` + optional inline port.
 *
 * Accepts `db.example.com`, `db.example.com:5433`, or a bare IPv4. IPv6 with a
 * port would be ambiguous with a bare `::1`, so an inline port is only parsed
 * when there's exactly one `:` and the tail is all digits; otherwise the whole
 * value is treated as the host and the port comes from `POSTGRES_PORT`.
 */
function parseHostEntry(entry: string): { host: string; inlinePort?: number } {
  const idx = entry.lastIndexOf(':')
  if (idx > 0 && idx === entry.indexOf(':')) {
    const tail = entry.slice(idx + 1)
    if (/^\d+$/.test(tail)) {
      return { host: entry.slice(0, idx), inlinePort: Number(tail) }
    }
  }
  return { host: entry }
}

/**
 * Parse the `POSTGRES_*` env lists into indexed source configs.
 *
 * Env vars (all comma-separated, index-aligned with `POSTGRES_HOST`):
 *  - `POSTGRES_HOST`     — hosts (`host` or `host:port`); the id space.
 *  - `POSTGRES_PORT`     — ports; falls back to inline port then 5432.
 *  - `POSTGRES_USER`     — users; a single value broadcasts to all hosts.
 *  - `POSTGRES_PASSWORD` — passwords; a single value broadcasts to all hosts.
 *  - `POSTGRES_DATABASE` — databases; falls back to the first, then `postgres`.
 *  - `POSTGRES_SSLMODE`  — libpq sslmodes; falls back to the first.
 *  - `POSTGRES_NAME`     — display names.
 *
 * Not memoized (unlike the ClickHouse resolver) because agent tool calls are
 * infrequent and tests mutate `process.env` between calls; re-parsing keeps it
 * honest and stays cheap.
 */
export function getPostgresConfigs(): PostgresSourceConfig[] {
  const hostEntries = splitByComma(process.env.POSTGRES_HOST)
  if (hostEntries.length === 0) return []

  const ports = splitByComma(process.env.POSTGRES_PORT)
  const users = splitByComma(process.env.POSTGRES_USER)
  const passwords = splitByComma(process.env.POSTGRES_PASSWORD)
  const databases = splitByComma(process.env.POSTGRES_DATABASE)
  const sslmodes = splitByComma(process.env.POSTGRES_SSLMODE)
  const names = splitByComma(process.env.POSTGRES_NAME)

  const broadcastUser = users.length === 1
  const broadcastPassword = passwords.length === 1

  return hostEntries.map((entry, index) => {
    const { host, inlinePort } = parseHostEntry(entry)
    const listPort = ports[index] ?? ports[0]
    const port = inlinePort ?? (listPort ? Number(listPort) : DEFAULT_PG_PORT)

    const user = broadcastUser ? users[0] : (users[index] ?? 'postgres')
    const password = broadcastPassword ? passwords[0] : (passwords[index] ?? '')
    const database = databases[index] ?? databases[0] ?? 'postgres'
    const sslmode = sslmodes[index] ?? sslmodes[0]
    const customName = names[index]

    return {
      id: index,
      host,
      port: Number.isFinite(port) ? port : DEFAULT_PG_PORT,
      user,
      password,
      database,
      ...(sslmode ? { sslmode } : {}),
      ...(customName ? { customName } : {}),
    }
  })
}

/**
 * Resolve a single Postgres source by `pgHostId`, throwing a clear error when
 * none are configured or the id is out of range. Centralises the "lookup +
 * validate" step for the agent's Postgres tools.
 */
export function getAndValidatePostgresConfig(
  pgHostId: number
): PostgresSourceConfig {
  const configs = getPostgresConfigs()
  if (configs.length === 0) {
    throw new Error(
      'No Postgres sources configured. Set POSTGRES_HOST (and POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DATABASE) to enable Postgres tools.'
    )
  }
  const config = configs[pgHostId]
  if (!config) {
    throw new Error(
      `Invalid pgHostId: ${pgHostId}. Available Postgres sources: 0-${configs.length - 1}`
    )
  }
  return config
}
