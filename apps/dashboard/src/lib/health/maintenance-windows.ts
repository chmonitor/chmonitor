/**
 * Maintenance windows — passive alert-dispatch suppression (plan 28).
 *
 * Lets an operator declare "planned work" (a deploy, a backup, …) for one
 * host or every host, with a start/end time and a reason. While `now` falls
 * inside a matching window, `server-sweep.ts` skips the outbound webhook for
 * an otherwise-notify-worthy finding — the rule still runs and the finding is
 * still reported in the sweep summary; this is a dispatch-time gate, not a
 * data-collection gate, and it must never change dedup semantics
 * (`alert-state-store.ts`'s `decideNotification` is untouched).
 *
 * Storage mirrors `insights/store/d1-store.ts`: a dedicated `MAINTENANCE_D1`
 * binding takes precedence, falling back to the shared `CHM_CLOUD_D1`
 * binding used by the rest of the cloud-mode D1 backends. The table is
 * migrated lazily (single-flight) on first use. Every failure is caught,
 * logged, and swallowed — a missing/misconfigured binding degrades to "no
 * windows" (self-hosted/OSS default) rather than throwing into the sweep or
 * the CRUD route.
 *
 * `isSuppressed` is the pure, D1-free core so the suppression rule itself is
 * fully unit-testable without mocking D1.
 */

import type { HealthSqlDb } from './sql-db'

import {
  mergeSources,
  type Sourced,
  type SourceLayer,
} from './declarative/merge'
import { readHealthConfigLayers } from './declarative/sources'
import { getHealthDb } from './resolve-store'
import { isPostgresHealthDb } from './sql-db'
import { ErrorLogger } from '@chm/logger'

const COMPONENT = 'maintenance-windows'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[maintenance-windows] ${msg}`, {
    component: COMPONENT,
  })

/** Preferred dedicated binding, then the shared cloud-mode D1 binding. */
const D1_BINDING_NAMES = ['MAINTENANCE_D1', 'CHM_CLOUD_D1'] as const

const TABLE = 'maintenance_windows'

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL,
    host_id INTEGER,
    reason TEXT NOT NULL DEFAULT '',
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )
`
const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_maint_windows_active
    ON ${TABLE} (owner_id, ends_at)
`

export interface MaintenanceWindow {
  id: string
  ownerId: string
  /** null => applies to ALL hosts for this owner. */
  hostId: number | null
  reason: string
  /** unix ms */
  startsAt: number
  /** unix ms */
  endsAt: number
  createdBy: string
  /** unix ms */
  createdAt: number
}

export interface CreateMaintenanceWindowInput {
  ownerId: string
  hostId: number | null
  reason: string
  startsAt: number
  endsAt: number
  createdBy: string
}

/** D1 row shape (snake_case columns). */
interface D1WindowRow {
  id: string
  owner_id: string
  host_id: number | null
  reason: string
  starts_at: number
  ends_at: number
  created_by: string
  created_at: number
}

function rowToWindow(row: D1WindowRow): MaintenanceWindow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    hostId: row.host_id,
    reason: row.reason,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function getDb(): HealthSqlDb | null {
  return getHealthDb({ bindingNames: D1_BINDING_NAMES })
}

// Single-flight migration: concurrent first calls share one promise so the
// idempotent DDL runs at most once; a failure clears it so the next call retries.
let migration: Promise<void> | null = null

function ensureMigrated(db: HealthSqlDb): Promise<void> {
  // Postgres: the adapter bootstraps its own schema (postgres-schema.ts).
  if (isPostgresHealthDb(db)) return Promise.resolve()
  if (!migration) {
    migration = (async () => {
      try {
        await db.batch([db.prepare(MIGRATION_SQL), db.prepare(INDEX_SQL)])
      } catch (err) {
        migration = null
        throw err
      }
    })()
  }
  return migration
}

// ---------------------------------------------------------------------------
// Best-effort 30s in-memory cache of active windows per owner, so a health
// sweep tick doesn't pay a D1 read for every host/rule combination. Cleared
// implicitly by TTL; a create/delete invalidates the affected owner's entry
// so the UI + sweep never observe stale data for more than the TTL.
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30_000
const cache = new Map<
  string,
  { windows: MaintenanceWindow[]; expiresAt: number }
>()

function invalidateCache(ownerId: string): void {
  cache.delete(ownerId)
}

/**
 * Pure suppression check — true iff any window targets this host (or ALL
 * hosts, `hostId === null`) and `now` falls within `[startsAt, endsAt)`.
 * No I/O, no D1 — exercised directly by unit tests.
 */
export function isSuppressed(
  windows: MaintenanceWindow[],
  hostId: number,
  now: number
): boolean {
  return windows.some(
    (w) =>
      (w.hostId === null || w.hostId === hostId) &&
      w.startsAt <= now &&
      now < w.endsAt
  )
}

/**
 * List every maintenance window for an owner (past, current, and upcoming —
 * callers filter to "active" via `isSuppressed`): the DB rows plus the
 * declarative `maintenance.yaml` windows (#3497), merged as a TIME UNION —
 * windows from every source are active at once, and only a shared `id` is
 * shadowed (whole window, never field by field). Best-effort: a missing or
 * failing DB contributes no rows and the declarative windows still apply.
 */
export async function listWindows(
  ownerId: string
): Promise<Sourced<MaintenanceWindow>[]> {
  const [rows, declared] = await Promise.all([
    listDbWindows(ownerId),
    declarativeMaintenanceWindows(ownerId),
  ])
  return mergeSources(
    [...declared, { source: 'd1', entries: rows }],
    (window) => window.id,
    'time-union'
  )
}

/** The DB rows only (30s-cached) — `[]` without a DB or on any error. */
async function listDbWindows(ownerId: string): Promise<MaintenanceWindow[]> {
  const cached = cache.get(ownerId)
  if (cached && cached.expiresAt > Date.now()) return cached.windows

  try {
    const db = getDb()
    if (!db) return []
    await ensureMigrated(db)

    const result = await db
      .prepare(
        `SELECT id, owner_id, host_id, reason, starts_at, ends_at, created_by, created_at
         FROM ${TABLE}
         WHERE owner_id = ?1
         ORDER BY starts_at DESC`
      )
      .bind(ownerId)
      .all<D1WindowRow>()

    const windows = (result.results ?? []).map(rowToWindow)
    cache.set(ownerId, { windows, expiresAt: Date.now() + CACHE_TTL_MS })
    return windows
  } catch (err) {
    warn(`failed to list windows for owner ${ownerId}: ${err}`)
    return []
  }
}

/**
 * Create a maintenance window. Validates `endsAt > startsAt`. Throws on
 * invalid input (caller's problem to surface as a 400); a D1/binding failure
 * also throws so the CRUD route can report the write didn't happen (unlike
 * the read/suppression paths, a create failure must not look like success).
 */
export async function createWindow(
  input: CreateMaintenanceWindowInput
): Promise<MaintenanceWindow> {
  if (input.endsAt <= input.startsAt) {
    throw new Error('endsAt must be after startsAt')
  }

  const db = getDb()
  if (!db) {
    throw new Error(
      'No alert state backend configured (D1 binding MAINTENANCE_D1 / CHM_CLOUD_D1, or Postgres DATABASE_URL)'
    )
  }
  await ensureMigrated(db)

  const window: MaintenanceWindow = {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    hostId: input.hostId,
    reason: input.reason,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    createdBy: input.createdBy,
    createdAt: Date.now(),
  }

  await db
    .prepare(
      `INSERT INTO ${TABLE}
         (id, owner_id, host_id, reason, starts_at, ends_at, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      window.id,
      window.ownerId,
      window.hostId,
      window.reason,
      window.startsAt,
      window.endsAt,
      window.createdBy,
      window.createdAt
    )
    .run()

  invalidateCache(input.ownerId)
  return window
}

/** Thrown by {@link deleteWindow} when no alert state backend is configured. */
export class MaintenanceStoreUnavailableError extends Error {
  constructor() {
    super(
      'No alert state backend configured (D1 binding MAINTENANCE_D1 / CHM_CLOUD_D1, or Postgres DATABASE_URL)'
    )
    this.name = 'MaintenanceStoreUnavailableError'
  }
}

/**
 * Delete a maintenance window, scoped to its owner (an owner can never delete
 * another owner's window even by guessing an id). Returns the number of rows
 * deleted — `0` means no such window for this owner. Throws
 * {@link MaintenanceStoreUnavailableError} with no backend and rethrows a
 * backend failure, so the CRUD route never reports a delete that did not
 * happen as a success.
 */
export async function deleteWindow(
  ownerId: string,
  id: string
): Promise<number> {
  const db = getDb()
  if (!db) throw new MaintenanceStoreUnavailableError()
  await ensureMigrated(db)

  const res = await db
    .prepare(`DELETE FROM ${TABLE} WHERE id = ?1 AND owner_id = ?2`)
    .bind(id, ownerId)
    .run()

  invalidateCache(ownerId)
  return res.meta?.changes ?? 0
}

// ---------------------------------------------------------------------------
// Declarative reader: Maintenance windows — merge key `id`, time-union
// ---------------------------------------------------------------------------

async function declarativeMaintenanceWindows(
  ownerId: string
): Promise<SourceLayer<MaintenanceWindow>[]> {
  return (await readHealthConfigLayers()).map((layer) => ({
    source: layer.source,
    entries: Object.values(layer.data.maintenanceWindows).map((w) => ({
      id: w.id,
      ownerId,
      hostId: w.hostId,
      reason: w.reason,
      startsAt: Date.parse(w.startsAt),
      endsAt: Date.parse(w.endsAt),
      createdBy: layer.source,
      createdAt: 0,
    })),
  }))
}
