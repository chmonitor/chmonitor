/**
 * Custom webhook target store (feat #3414) — D1-backed, owner-scoped.
 *
 * Follows `alert-channel-config-store.ts` exactly:
 *   - Binding `CHM_CLOUD_D1` via {@link getPlatformBindings}; {@link getDb}
 *     returns `null` (never throws) when unconfigured.
 *   - ALL CRUD is best-effort and NEVER throws: a missing binding, an unmigrated
 *     table, or any D1 error resolves to `[]` / `null` / `false`. So a
 *     deployment with no D1 (the OSS default) degrades to "no custom targets",
 *     and the sweep simply skips the custom-target fan-out — the legacy global
 *     webhook + env behavior is byte-identical.
 *
 * Documented fallback when D1 is unavailable (no binding / migration not
 * applied): the API returns 501 on write with an explicit message, GET returns
 * `[]` with `storage: 'unavailable'`, and the UI shows a notice that custom
 * targets need the D1-backed store (Cloud /Workers deployment with migrations
 * applied) while the legacy single webhook keeps working from env/localStorage.
 *
 * Custom targets carry NO separate secret field: the URL is itself a
 * credential (Slack/Matrix URLs commonly embed tokens). The API returns only a
 * redacted URL and a configured flag; the raw value is returned only to
 * server-side delivery code.
 */

import type { CustomWebhookFormat } from './custom-webhook-targets'

import {
  isCustomWebhookFormat,
  normalizeCustomWebhookFormat,
  sanitizeCustomHeaders,
} from './custom-webhook-targets'
import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'custom-webhook-target'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[custom-webhook-target] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'alert_webhook_targets'

/** Storage cap: at most this many custom targets per owner. */
export const MAX_CUSTOM_WEBHOOK_TARGETS = 20

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

/** Whether the deployment has the D1 binding needed for persisted targets. */
export function isCustomWebhookStoreConfigured(): boolean {
  return getDb() !== null
}

export interface CustomWebhookTargetRow {
  id: string
  name: string
  url: string
  enabled: boolean
  format: CustomWebhookFormat
  minSeverity: 'warning' | 'critical' | null
  titleTemplate: string
  bodyTemplate: string
  headers: Record<string, string>
  updatedAt: number
}

interface D1TargetRow {
  owner_id: string
  id: string
  name: string
  url: string
  enabled: number
  format: string
  min_severity: string | null
  title_template: string | null
  body_template: string | null
  headers_json: string | null
  updated_at: number
}

function parseHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return sanitizeCustomHeaders(out).headers
  } catch {
    return {}
  }
}

function rowToTarget(row: D1TargetRow): CustomWebhookTargetRow {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled === 1,
    format: isCustomWebhookFormat(row.format)
      ? normalizeCustomWebhookFormat(row.format)
      : 'auto',
    minSeverity:
      row.min_severity === 'warning' || row.min_severity === 'critical'
        ? row.min_severity
        : null,
    titleTemplate: row.title_template ?? '',
    bodyTemplate: row.body_template ?? '',
    headers: parseHeaders(row.headers_json),
    updatedAt: row.updated_at,
  }
}

/** SELECT every custom target for an owner. Exported for the SQL round-trip test. */
export const D1_LIST_WEBHOOK_TARGETS_SQL = `SELECT owner_id, id, name, url, enabled, format, min_severity, title_template, body_template, headers_json, updated_at
   FROM ${TABLE}
   WHERE owner_id = ?1
   ORDER BY name ASC`

/** Upsert one target keyed by (owner_id, id). Exported for the SQL round-trip test. */
export const D1_UPSERT_WEBHOOK_TARGET_SQL = `INSERT INTO ${TABLE}
     (owner_id, id, name, url, enabled, format, min_severity, title_template, body_template, headers_json, updated_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
   ON CONFLICT(owner_id, id) DO UPDATE SET
     name = excluded.name,
     url = CASE
        WHEN excluded.url IS NULL OR excluded.url = ''
          THEN alert_webhook_targets.url
          ELSE excluded.url
      END,
     enabled = excluded.enabled,
     format = excluded.format,
     min_severity = excluded.min_severity,
     title_template = excluded.title_template,
     body_template = excluded.body_template,
     headers_json = excluded.headers_json,
     updated_at = excluded.updated_at`

/** Delete one target by composite owner/id key. Exported for the SQL round-trip test. */
export const D1_DELETE_WEBHOOK_TARGET_SQL = `DELETE FROM ${TABLE} WHERE owner_id = ?1 AND id = ?2`

/**
 * List every custom target for an owner, best-effort. Returns `[]` when D1
 * isn't configured (self-hosted/OSS default) or on any store error — NEVER
 * throws, so a missing table can never break the sweep or the settings UI.
 */
export async function listCustomWebhookTargets(
  ownerId: string
): Promise<CustomWebhookTargetRow[]> {
  try {
    const db = getDb()
    if (!db) return []
    const result = await db
      .prepare(D1_LIST_WEBHOOK_TARGETS_SQL)
      .bind(ownerId)
      .all<D1TargetRow>()
    return (result.results ?? []).map(rowToTarget)
  } catch (err) {
    warn(`failed to list custom webhook targets for owner ${ownerId}: ${err}`)
    return []
  }
}

export interface UpsertCustomWebhookTargetInput {
  ownerId: string
  id: string
  name: string
  /** Empty keeps the existing secret URL on update. */
  url?: string
  enabled: boolean
  format: CustomWebhookFormat
  minSeverity?: 'warning' | 'critical' | null
  titleTemplate?: string
  bodyTemplate?: string
  headers?: Record<string, string>
}

/**
 * Create or update one custom target, best-effort. Returns the saved row on
 * success, or `null` when D1 is unavailable / the write failed — never throws.
 */
export async function upsertCustomWebhookTarget(
  input: UpsertCustomWebhookTargetInput
): Promise<CustomWebhookTargetRow | null> {
  try {
    const db = getDb()
    if (!db) return null
    const now = Date.now()
    await db
      .prepare(D1_UPSERT_WEBHOOK_TARGET_SQL)
      .bind(
        input.ownerId,
        input.id,
        input.name,
        input.url ?? '',
        input.enabled ? 1 : 0,
        input.format,
        input.minSeverity === 'warning' || input.minSeverity === 'critical'
          ? input.minSeverity
          : null,
        input.titleTemplate ?? '',
        input.bodyTemplate ?? '',
        JSON.stringify(input.headers ?? {}),
        now
      )
      .run()
    const all = await listCustomWebhookTargets(input.ownerId)
    return all.find((t) => t.id === input.id) ?? null
  } catch (err) {
    warn(
      `failed to upsert custom webhook target ${input.id} for owner ${input.ownerId}: ${err}`
    )
    return null
  }
}

/**
 * Delete one custom target, owner-scoped. Returns whether a row was removed.
 * Best-effort — returns `false` on any store failure.
 */
export async function deleteCustomWebhookTarget(
  ownerId: string,
  id: string
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    const res = await db
      .prepare(D1_DELETE_WEBHOOK_TARGET_SQL)
      .bind(ownerId, id)
      .run()
    return (res.meta?.changes ?? 0) > 0
  } catch (err) {
    warn(
      `failed to delete custom webhook target ${id} for owner ${ownerId}: ${err}`
    )
    return false
  }
}
