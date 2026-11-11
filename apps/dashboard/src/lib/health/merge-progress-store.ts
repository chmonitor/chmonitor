import type { MergeProgressSnapshot } from './merge-progress'
import type { HealthSqlDb } from './sql-db'

import { MERGE_WORK_COUNTERS } from './merge-progress'
import { getHealthDb } from './resolve-store'
import { isPostgresHealthDb } from './sql-db'

export type MergeProgressMode = 'read' | 'observe'
export interface MergeProgressStore {
  load(
    hostKey: string,
    mode: MergeProgressMode
  ): Promise<MergeProgressSnapshot | null>
  save(
    hostKey: string,
    previous: MergeProgressSnapshot,
    next: MergeProgressSnapshot
  ): Promise<boolean>
}

export const MERGE_PROGRESS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS merge_progress_snapshots (
  host_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
)`

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Corrupt persisted evidence is unavailable, never a new empty snapshot. */
export function parseMergeSnapshot(
  json: string,
  version: number,
  updated: number
): MergeProgressSnapshot | null {
  try {
    const s = JSON.parse(json) as MergeProgressSnapshot
    if (
      !s ||
      !Number.isSafeInteger(s.version) ||
      s.version < 1 ||
      s.version !== version ||
      !finite(s.updatedAtMs) ||
      s.updatedAtMs !== updated ||
      !Array.isArray(s.samples)
    )
      return null
    const identities = new Set<string>()
    for (const sample of s.samples) {
      if (
        !sample ||
        typeof sample.identity !== 'string' ||
        typeof sample.name !== 'string' ||
        identities.has(sample.identity) ||
        !finite(sample.elapsed) ||
        sample.elapsed < 0 ||
        !finite(sample.progress) ||
        sample.progress < 0 ||
        !finite(sample.startedAtMs) ||
        !finite(sample.startedLatestMs) ||
        sample.startedLatestMs < sample.startedAtMs ||
        typeof sample.confirmedWork !== 'boolean' ||
        !finite(sample.observedAtMs) ||
        sample.observedAtMs !== s.updatedAtMs ||
        !finite(sample.flatSinceMs) ||
        sample.flatSinceMs < 0 ||
        sample.flatSinceMs > sample.observedAtMs ||
        !Array.isArray(sample.counters) ||
        sample.counters.length !== MERGE_WORK_COUNTERS.length ||
        !sample.counters.every(
          (c) => typeof c === 'string' && /^(0|[1-9]\d*)$/.test(c)
        )
      )
        return null
      identities.add(sample.identity)
    }
    return s
  } catch {
    return null
  }
}

/** One snapshot per stable host; CAS works across Workers and server replicas. */
export function createMergeProgressStore(
  resolveDb: () => HealthSqlDb | null = getHealthDb
): MergeProgressStore {
  const migrations = new WeakMap<HealthSqlDb, Promise<void>>()
  async function ensureMigrated(db: HealthSqlDb) {
    if (isPostgresHealthDb(db)) return
    let migration = migrations.get(db)
    if (!migration) {
      migration = db
        .prepare(MERGE_PROGRESS_SCHEMA_SQL)
        .run()
        .then((r) => {
          if (!r.success) throw new Error('merge progress migration failed')
        })
        .catch((err) => {
          migrations.delete(db)
          throw err
        })
      migrations.set(db, migration)
    }
    await migration
  }
  return {
    async load(hostKey, mode) {
      try {
        const db = resolveDb()
        if (!db) return null
        if (mode === 'observe') await ensureMigrated(db)
        const sql =
          'SELECT version, updated_at, snapshot_json FROM merge_progress_snapshots WHERE host_key = ?1'
        const statement =
          mode === 'read' && isPostgresHealthDb(db)
            ? db.prepareReadOnly(sql)
            : db.prepare(sql)
        const result = await statement
          .bind(hostKey)
          .all<{ version: number; updated_at: number; snapshot_json: string }>()
        if (!result.success || !Array.isArray(result.results)) return null
        if (result.results.length === 0)
          return { version: 0, updatedAtMs: 0, samples: [] }
        if (result.results.length !== 1) return null
        const row = result.results[0]
        return parseMergeSnapshot(
          row.snapshot_json,
          Number(row.version),
          Number(row.updated_at)
        )
      } catch {
        return null
      }
    },
    async save(hostKey, previous, next) {
      try {
        const db = resolveDb()
        if (
          !db ||
          next.version !== previous.version + 1 ||
          next.updatedAtMs <= previous.updatedAtMs
        )
          return false
        const sql =
          previous.version === 0
            ? `INSERT INTO merge_progress_snapshots (host_key, version, updated_at, snapshot_json)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT (host_key) DO NOTHING`
            : `UPDATE merge_progress_snapshots SET version = ?2, updated_at = ?3, snapshot_json = ?4
             WHERE host_key = ?1 AND version = ?5 AND updated_at < ?3`
        const statement = db.prepare(sql)
        const params = [
          hostKey,
          next.version,
          next.updatedAtMs,
          JSON.stringify(next),
        ]
        if (previous.version !== 0) params.push(previous.version)
        const result = await statement.bind(...params).run()
        return result.success && result.meta.changes === 1
      } catch {
        return false
      }
    },
  }
}

export const healthDbMergeProgressStore = createMergeProgressStore()
