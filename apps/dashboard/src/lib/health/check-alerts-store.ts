/**
 * Built-in health check alerts as `custom_alert_rules` rows (#3438, PR 1/3).
 *
 * A check alert is the operator's display name for one built-in check. It
 * lives in `custom_alert_rules` with `check_id` = `HealthCheckDef.id` and no
 * metric/op/thresholds (migration 0032). `check_id` is the stable key: the
 * alert's `ruleId` is the check id, so `alert_state` / `alert_acks` — keyed on
 * `(hostId, ruleId)` — are never re-keyed and a rename never resets an ACK.
 *
 * Name only. There is no `enabled` toggle here: the sweep does not read these
 * rows, so a stored switch would be a lie. The `enabled` column keeps its
 * default and is never exposed.
 *
 * `custom-rules-store.ts` filters `check_id IS NULL` everywhere, so these rows
 * never reach the rule builder, the sweep registry, or the custom DELETE.
 *
 * Read path: every known check is listed with its default title, merged with
 * any stored name. With no metadata DB the list is still returned (defaults,
 * read-only); writes throw `NOT_CONFIGURED` (→ 501) like the sibling store.
 * The declarative `alerts.yaml` has no field that names a check, so there is
 * no file/env layer to merge.
 */

import { z } from 'zod'

import type { HealthSqlDb } from './sql-db'

import { CustomRuleStoreError } from './custom-rules-store'
import { getHealthDb } from './resolve-store'
import { MAX_NAME_LENGTH } from './rule-builder-schema'
import { HEALTH_CHECKS } from '@/components/health/health-checks'

/** Default title per known check id, in `HEALTH_CHECKS` order. */
const DEFAULT_TITLES: ReadonlyMap<string, string> = new Map(
  HEALTH_CHECKS.map((check) => [check.id, check.title])
)

export function isKnownCheckId(checkId: string): boolean {
  return DEFAULT_TITLES.has(checkId)
}

/** Where a check alert's name comes from. */
export type CheckAlertSource = 'default' | 'd1'

export interface CheckAlert {
  /** The built-in check id — the stable key. */
  checkId: string
  /** The `alert_state` / `alert_acks` rule id. Always equal to `checkId`. */
  ruleId: string
  /** The name to display: the stored name, else the default title. */
  name: string
  /** The check's built-in title. */
  defaultName: string
  /** `d1` when a stored name exists (a Postgres row reports `d1` too). */
  source: CheckAlertSource
  /** When the stored name was last written; `null` for a default. */
  updatedAt: number | null
}

export const checkAlertNameSchema = z
  .string()
  .trim()
  .min(1, 'Name must not be empty')
  .max(MAX_NAME_LENGTH, `Name must be at most ${MAX_NAME_LENGTH} characters`)

interface CheckAlertRow {
  check_id: string
  name: string
  created_at: number
}

export const D1_LIST_CHECK_ALERTS_SQL = `SELECT check_id, name, created_at FROM custom_alert_rules WHERE owner_id = ?1 AND check_id IS NOT NULL`

/**
 * Insert or rename. The first row's `id` is kept on conflict; `created_at`
 * is refreshed so it reads as "last renamed".
 */
export const D1_UPSERT_CHECK_ALERT_SQL = `INSERT INTO custom_alert_rules (id, owner_id, name, enabled, created_at, check_id)
VALUES (?1, ?2, ?3, 1, ?4, ?5)
ON CONFLICT(owner_id, check_id) DO UPDATE SET
  name = excluded.name,
  created_at = excluded.created_at`

export const D1_DELETE_CHECK_ALERT_SQL = `DELETE FROM custom_alert_rules WHERE owner_id = ?1 AND check_id = ?2`

function storageError(action: string, err: unknown): CustomRuleStoreError {
  return new CustomRuleStoreError(
    `Failed to ${action} check alert: ${err instanceof Error ? err.message : 'Unknown error'}`,
    'STORAGE_ERROR',
    err
  )
}

function requireDb(): HealthSqlDb {
  const db = getHealthDb()
  if (!db) {
    throw new CustomRuleStoreError(
      'No alert state backend configured. Naming check alerts requires a D1 binding (CHM_CLOUD_D1) or a Postgres DATABASE_URL.',
      'NOT_CONFIGURED'
    )
  }
  return db
}

function requireKnownCheck(checkId: string): void {
  if (!isKnownCheckId(checkId)) {
    throw new CustomRuleStoreError(
      `Unknown health check "${checkId}"`,
      'NOT_FOUND'
    )
  }
}

/**
 * Every known check, with its stored name when one exists. No DB ⇒ defaults.
 * A DB read failure throws `STORAGE_ERROR` rather than showing defaults, so a
 * broken table is reported instead of silently hiding the operator's names.
 */
export async function listCheckAlerts(ownerId: string): Promise<CheckAlert[]> {
  const stored = new Map<string, CheckAlertRow>()
  const db = getHealthDb()
  if (db) {
    try {
      const result = await db
        .prepare(D1_LIST_CHECK_ALERTS_SQL)
        .bind(ownerId)
        .all<CheckAlertRow>()
      for (const row of result.results || []) stored.set(row.check_id, row)
    } catch (err) {
      throw storageError('list', err)
    }
  }

  return [...DEFAULT_TITLES].map(([checkId, defaultName]) => {
    const row = stored.get(checkId)
    return {
      checkId,
      ruleId: checkId,
      name: row?.name ?? defaultName,
      defaultName,
      source: row ? 'd1' : 'default',
      updatedAt: row ? Number(row.created_at) : null,
    }
  })
}

/** Name (or rename) one check's alert. Returns the merged entry. */
export async function renameCheckAlert(
  ownerId: string,
  checkId: string,
  name: unknown
): Promise<CheckAlert> {
  requireKnownCheck(checkId)
  const parsed = checkAlertNameSchema.parse(name)
  const db = requireDb()
  const now = Date.now()
  try {
    await db
      .prepare(D1_UPSERT_CHECK_ALERT_SQL)
      .bind(`check:${crypto.randomUUID()}`, ownerId, parsed, now, checkId)
      .run()
  } catch (err) {
    throw storageError('rename', err)
  }
  return {
    checkId,
    ruleId: checkId,
    name: parsed,
    defaultName: DEFAULT_TITLES.get(checkId) as string,
    source: 'd1',
    updatedAt: now,
  }
}

/** Drop the stored name so the check shows its default title. Idempotent. */
export async function resetCheckAlert(
  ownerId: string,
  checkId: string
): Promise<CheckAlert> {
  requireKnownCheck(checkId)
  const db = requireDb()
  try {
    await db.prepare(D1_DELETE_CHECK_ALERT_SQL).bind(ownerId, checkId).run()
  } catch (err) {
    throw storageError('reset', err)
  }
  const defaultName = DEFAULT_TITLES.get(checkId) as string
  return {
    checkId,
    ruleId: checkId,
    name: defaultName,
    defaultName,
    source: 'default',
    updatedAt: null,
  }
}
