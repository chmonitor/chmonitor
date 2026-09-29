/**
 * Backend resolution for the twelve health/alert stores (#3493).
 *
 * Chain: D1 binding → Postgres (`DATABASE_URL` / `POSTGRES_URL` /
 * `POSTGRES_PRISMA_URL`) → none. No backend ⇒ `null` ⇒ the store reports the
 * feature unavailable (fail closed).
 *
 * This deliberately does NOT follow `resolveStateBackend()` from
 * `lib/state-backend/config.ts`: that order puts ClickHouse before Postgres,
 * and the alert stores have no ClickHouse implementation, so a
 * ClickHouse+Postgres deployment would lose alerts. Known gap: on a
 * ClickHouse-ONLY state backend `metadataDb.available` is `true` while every
 * alert store here resolves to `null`.
 *
 * `getPlatformBindings` is imported from `@chm/platform` on purpose — the
 * store tests `mock.module('@chm/platform')` to hand the stores a fake D1.
 */

import type { HealthSqlDb } from './sql-db'

import { HEALTH_POSTGRES_SCHEMA_SQL } from './postgres-schema'
import { PostgresHealthDb } from './sql-db'
import { getPlatformBindings } from '@chm/platform'
import { getStatePostgresUrl } from '@/lib/state-backend/config'

export type HealthStoreBackend = 'd1' | 'postgres'

/** The default D1 binding. Some stores prefer `MAINTENANCE_D1` first. */
export const HEALTH_D1_BINDINGS: readonly string[] = ['CHM_CLOUD_D1']

export type HealthD1Probe = (bindingName: string) => D1Database | null

const defaultProbe: HealthD1Probe = (bindingName) => {
  try {
    return getPlatformBindings().getD1Database(bindingName)
  } catch {
    return null
  }
}

export interface ResolveHealthOptions {
  /** D1 binding names to try, in order. */
  bindingNames?: readonly string[]
  env?: Record<string, string | undefined>
  probe?: HealthD1Probe
}

/** Which backend the health stores resolve to, or `null` (fail closed). */
export function resolveHealthBackend(
  options: ResolveHealthOptions = {}
): HealthStoreBackend | null {
  const { bindingNames = HEALTH_D1_BINDINGS, probe = defaultProbe } = options
  if (bindingNames.some((name) => probe(name) !== null)) return 'd1'
  if (getStatePostgresUrl(options.env ?? process.env)) return 'postgres'
  return null
}

// One pooled client per URL, shared by every store (each calls getHealthDb()
// on every operation).
const postgresDbs = new Map<string, PostgresHealthDb>()

/**
 * The executor for a health store: the first bound D1 database, else the
 * shared Postgres adapter, else `null`. Synchronous — never connects.
 */
export function getHealthDb(
  options: ResolveHealthOptions = {}
): HealthSqlDb | null {
  const { bindingNames = HEALTH_D1_BINDINGS, probe = defaultProbe } = options
  for (const name of bindingNames) {
    const db = probe(name)
    if (db) return db
  }
  const url = getStatePostgresUrl(options.env ?? process.env)
  if (!url) return null
  let db = postgresDbs.get(url)
  if (!db) {
    db = new PostgresHealthDb(url, HEALTH_POSTGRES_SCHEMA_SQL)
    postgresDbs.set(url, db)
  }
  return db
}
