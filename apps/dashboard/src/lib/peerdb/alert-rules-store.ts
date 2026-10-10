/**
 * PeerDB alert rules store (#3699).
 *
 * Same storage contract as the other alert-settings stores
 * (`maintenance-windows.ts`, `quiet-hours.ts`): the shared health DB
 * (`CHM_CLOUD_D1`, or Postgres via `DATABASE_URL`) resolved by
 * `getHealthDb`, a lazily migrated table, owner-scoped rows. Reads also
 * merge the declarative `alerts.yaml` `peerdbRules` (merge key `id`, union),
 * so a DB-free deploy still gets its file rules; those are read-only in the UI.
 *
 * Reads never throw (no DB → only declarative rules). Writes throw so the
 * route can report that nothing was saved.
 */

import type { HealthSqlDb } from '@/lib/health/sql-db'
import type { PeerDBRule } from './alert-rules'

import { ErrorLogger } from '@chm/logger'
import {
  mergeSources,
  type Sourced,
  type SourceLayer,
} from '@/lib/health/declarative/merge'
import { readHealthConfigLayers } from '@/lib/health/declarative/sources'
import { getHealthDb } from '@/lib/health/resolve-store'
import { isPostgresHealthDb } from '@/lib/health/sql-db'

const TABLE = 'peerdb_alert_rules'

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL,
    check_type TEXT NOT NULL,
    match_kind TEXT NOT NULL,
    match TEXT NOT NULL,
    warning REAL NOT NULL,
    critical REAL NOT NULL,
    severity TEXT NOT NULL DEFAULT 'critical',
    enabled INTEGER NOT NULL DEFAULT 1,
    mute_until INTEGER,
    created_at INTEGER NOT NULL
  )
`
const INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_peerdb_alert_rules_owner
    ON ${TABLE} (owner_id)
`

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[peerdb-alert-rules] ${msg}`, {
    component: 'peerdb-alert-rules',
  })

interface RuleRow {
  id: string
  check_type: string
  match_kind: string
  match: string
  warning: number
  critical: number
  severity: string
  enabled: number
  mute_until: number | null
}

function rowToRule(row: RuleRow): PeerDBRule {
  return {
    id: row.id,
    check: row.check_type as PeerDBRule['check'],
    matchKind: row.match_kind as PeerDBRule['matchKind'],
    match: row.match,
    warning: Number(row.warning),
    critical: Number(row.critical),
    severity: row.severity === 'warning' ? 'warning' : 'critical',
    enabled: Number(row.enabled) === 1,
    muteUntil: row.mute_until === null ? null : Number(row.mute_until),
  }
}

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

function requireDb(): HealthSqlDb {
  const db = getHealthDb()
  if (!db) {
    throw new Error(
      'No alert state backend configured (D1 binding CHM_CLOUD_D1, or Postgres DATABASE_URL)'
    )
  }
  return db
}

async function listDbRules(ownerId: string): Promise<PeerDBRule[]> {
  try {
    const db = getHealthDb()
    if (!db) return []
    await ensureMigrated(db)
    const result = await db
      .prepare(
        `SELECT id, check_type, match_kind, match, warning, critical, severity, enabled, mute_until
         FROM ${TABLE}
         WHERE owner_id = ?1
         ORDER BY created_at ASC`
      )
      .bind(ownerId)
      .all<RuleRow>()
    return (result.results ?? []).map(rowToRule)
  } catch (err) {
    warn(`failed to list rules for owner ${ownerId}: ${err}`)
    return []
  }
}

async function declarativeRules(): Promise<SourceLayer<PeerDBRule>[]> {
  return (await readHealthConfigLayers()).map((layer) => ({
    source: layer.source,
    entries: Object.values(layer.data.peerdbRules ?? {}).map((r) => ({
      id: r.id,
      check: r.check,
      matchKind: r.matchKind,
      match: r.match.trim(),
      warning: r.warning,
      critical: r.critical,
      severity: r.severity,
      enabled: r.enabled,
      muteUntil: r.muteUntil === null ? null : Date.parse(r.muteUntil),
    })),
  }))
}

/** DB rows plus declarative rules, merged by `id`. Never throws. */
export async function listPeerDBRules(
  ownerId: string
): Promise<Sourced<PeerDBRule>[]> {
  const [rows, declared] = await Promise.all([
    listDbRules(ownerId),
    declarativeRules().catch(() => []),
  ])
  return mergeSources(
    [...declared, { source: 'd1', entries: rows }],
    (rule) => rule.id,
    'union'
  )
}

/** Insert or update (by `id`, within the owner) one rule. Throws on failure. */
export async function savePeerDBRule(
  ownerId: string,
  rule: PeerDBRule
): Promise<PeerDBRule> {
  const db = requireDb()
  await ensureMigrated(db)
  await db
    .prepare(
      `INSERT INTO ${TABLE}
         (id, owner_id, check_type, match_kind, match, warning, critical, severity, enabled, mute_until, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (id) DO UPDATE SET
         check_type = excluded.check_type,
         match_kind = excluded.match_kind,
         match = excluded.match,
         warning = excluded.warning,
         critical = excluded.critical,
         severity = excluded.severity,
         enabled = excluded.enabled,
         mute_until = excluded.mute_until
       WHERE ${TABLE}.owner_id = excluded.owner_id`
    )
    .bind(
      rule.id,
      ownerId,
      rule.check,
      rule.matchKind,
      rule.match,
      rule.warning,
      rule.critical,
      rule.severity,
      rule.enabled ? 1 : 0,
      rule.muteUntil,
      Date.now()
    )
    .run()
  return rule
}

/** Delete one rule, scoped to its owner. Throws on failure. */
export async function deletePeerDBRule(
  ownerId: string,
  id: string
): Promise<void> {
  const db = requireDb()
  await ensureMigrated(db)
  await db
    .prepare(`DELETE FROM ${TABLE} WHERE id = ?1 AND owner_id = ?2`)
    .bind(id, ownerId)
    .run()
}
