/**
 * Throughput-zero samples (#3728).
 *
 * `rowsSynced` is a running total, so one reading cannot show throughput. The
 * cycle keeps the previous `{ rowsSynced, sinceMs }` per mirror between sweep
 * ticks in `peerdb_throughput_samples`, a small table on the shared health DB
 * (`CHM_CLOUD_D1`, or Postgres via `DATABASE_URL`) — the same DB the PeerDB
 * rules store uses. No DB, or a failed read, means the check is off for that
 * tick: no sample, no finding, no false alarm.
 *
 * Only running CDC mirrors are sampled. A non-running mirror's sample is
 * dropped, so a resumed mirror starts a fresh window instead of inheriting
 * the paused time as "no new rows".
 */

import type { HealthSqlDb } from '@/lib/health/sql-db'
import type { PeerDBMirrorSignal } from './alerting'

import { peerDBFlowSlug } from './flow-slug'
import { ErrorLogger } from '@chm/logger'
import { getHealthDb } from '@/lib/health/resolve-store'
import { isPostgresHealthDb } from '@/lib/health/sql-db'

export interface PeerDBThroughputSample {
  rowsSynced: number
  /** Epoch ms when `rowsSynced` last changed (or was first observed). */
  sinceMs: number
}

/** Samples keyed by `peerDBFlowSlug(flowName)`. */
export type PeerDBThroughputSamples = Map<string, PeerDBThroughputSample>

/** Persistence for samples. `load` returns `null` when unavailable. */
export interface PeerDBThroughputStore {
  load(): Promise<PeerDBThroughputSamples | null>
  save(
    upserts: PeerDBThroughputSamples,
    deletes: readonly string[],
    now: number
  ): Promise<void>
}

/**
 * Pure step: given the previous sample and the current total, return the next
 * sample and how long the total has been flat. First tick (no previous) and a
 * changed total (growth, or a reset/decrease) both start a fresh window, so
 * `flatSec` is `null` / `0` — never a finding.
 */
export function stepThroughputSample(
  prev: PeerDBThroughputSample | null,
  rowsSynced: number,
  now: number
): { next: PeerDBThroughputSample; flatSec: number | null } {
  if (!prev) return { next: { rowsSynced, sinceMs: now }, flatSec: null }
  if (rowsSynced !== prev.rowsSynced) {
    return { next: { rowsSynced, sinceMs: now }, flatSec: 0 }
  }
  return { next: prev, flatSec: Math.max(0, (now - prev.sinceMs) / 1000) }
}

/**
 * Pure: compute `rowsFlatSec` per signal (same order) from the loaded
 * samples, plus the rows to write back. `null` samples = store unavailable →
 * every value is `null` and nothing is written.
 */
export function computePeerDBThroughput(
  signals: readonly PeerDBMirrorSignal[],
  samples: PeerDBThroughputSamples | null,
  now: number
): {
  flatSec: Array<number | null>
  upserts: PeerDBThroughputSamples
  deletes: string[]
} {
  const upserts: PeerDBThroughputSamples = new Map()
  const deletes: string[] = []
  const flatSec = signals.map((signal) => {
    if (!samples) return null
    const slug = peerDBFlowSlug(signal.flowName)
    const running =
      signal.status?.trim() === 'STATUS_RUNNING' && signal.isCdc === true
    if (!running) {
      // Not running (or QRep): forget the window. An unreadable status is not
      // "not running" — keep the sample so a status blip does not reset it.
      if (signal.statusEndpointAvailable !== false && samples.has(slug)) {
        deletes.push(slug)
      }
      return null
    }
    const rows = signal.rowsSynced
    if (typeof rows !== 'number' || !Number.isFinite(rows)) return null
    const { next, flatSec } = stepThroughputSample(
      samples.get(slug) ?? null,
      rows,
      now
    )
    upserts.set(slug, next)
    return flatSec
  })
  return { flatSec, upserts, deletes }
}

// ---------------------------------------------------------------------------
// Health-DB store (D1 or Postgres)
// ---------------------------------------------------------------------------

const TABLE = 'peerdb_throughput_samples'

// Kept in sync with db/conversations-migrations/0034_peerdb_throughput_samples.sql
// and the Postgres schema in lib/health/postgres-schema.ts.
const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    flow_slug TEXT NOT NULL PRIMARY KEY,
    rows_synced INTEGER NOT NULL,
    since_ms INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[peerdb-throughput] ${msg}`, {
    component: 'peerdb-throughput',
  })

let migration: Promise<void> | null = null

function ensureMigrated(db: HealthSqlDb): Promise<void> {
  // Postgres: the adapter bootstraps its own schema (postgres-schema.ts).
  if (isPostgresHealthDb(db)) return Promise.resolve()
  if (!migration) {
    migration = (async () => {
      try {
        await db.prepare(MIGRATION_SQL).run()
      } catch (err) {
        migration = null
        throw err
      }
    })()
  }
  return migration
}

interface SampleRow {
  flow_slug: string
  rows_synced: number
  since_ms: number
}

/** The default store, on the shared health DB. */
export const healthDbThroughputStore: PeerDBThroughputStore = {
  async load() {
    try {
      const db = getHealthDb()
      if (!db) return null
      await ensureMigrated(db)
      const result = await db
        .prepare(`SELECT flow_slug, rows_synced, since_ms FROM ${TABLE}`)
        .all<SampleRow>()
      const out: PeerDBThroughputSamples = new Map()
      for (const row of result.results ?? []) {
        out.set(row.flow_slug, {
          rowsSynced: Number(row.rows_synced),
          sinceMs: Number(row.since_ms),
        })
      }
      return out
    } catch (err) {
      warn(`failed to load samples: ${String(err)}`)
      return null
    }
  },

  async save(upserts, deletes, now) {
    if (upserts.size === 0 && deletes.length === 0) return
    try {
      const db = getHealthDb()
      if (!db) return
      await ensureMigrated(db)
      const statements = [
        ...[...upserts].map(([slug, s]) =>
          db
            .prepare(
              `INSERT INTO ${TABLE} (flow_slug, rows_synced, since_ms, updated_at)
               VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT (flow_slug) DO UPDATE SET
                 rows_synced = excluded.rows_synced,
                 since_ms = excluded.since_ms,
                 updated_at = excluded.updated_at`
            )
            .bind(slug, s.rowsSynced, s.sinceMs, now)
        ),
        ...deletes.map((slug) =>
          db.prepare(`DELETE FROM ${TABLE} WHERE flow_slug = ?1`).bind(slug)
        ),
      ]
      await db.batch(statements)
    } catch (err) {
      warn(`failed to save samples: ${String(err)}`)
    }
  },
}
