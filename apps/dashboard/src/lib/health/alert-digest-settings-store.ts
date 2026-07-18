/**
 * Time-window digest settings — server-persisted on/off + window minutes (#2663).
 *
 * Digest mode is a channel-AGNOSTIC toggle (one window governs every delivery
 * target), so it does not fit the per-channel `alert_channel_config` shape as a
 * real channel. Rather than add a whole new table just for two fields, it is
 * stored as a single reserved row in that SAME table under a sentinel
 * `channel = '__digest__'` (never exposed in `ALERT_CONFIG_CHANNELS`, so it
 * never renders as a delivery channel): `enabled` reuses the enabled column and
 * `windowMinutes` rides in `target_json`.
 *
 * Follows `alert-channel-config-store.ts` exactly: `CHM_CLOUD_D1` via
 * {@link getPlatformBindings}, and ALL access is best-effort — a missing binding
 * (the OSS default) or any D1 error resolves to `null`/`false`, never throws, so
 * the sweep falls back to the `HEALTH_ALERT_DIGEST_MINUTES` env value.
 */

import { getServerDigestWindowMinutes } from './server-alert-config'
import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-digest-settings'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-digest-settings] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'alert_channel_config'
/** Reserved, non-public `channel` value that holds the digest settings row. */
const DIGEST_KEY = '__digest__'

/** Hard cap so a typo can't park findings for days. */
const MAX_WINDOW_MINUTES = 1440

export interface DigestSettings {
  enabled: boolean
  /** Buffer window in minutes; only meaningful when `enabled`. */
  windowMinutes: number
}

interface D1DigestRow {
  enabled: number
  target_json: string | null
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function parseWindowMinutes(targetJson: string | null): number {
  if (!targetJson) return 0
  try {
    const parsed = JSON.parse(targetJson) as { windowMinutes?: unknown }
    const raw = Number(parsed?.windowMinutes)
    if (!Number.isFinite(raw) || raw < 0) return 0
    return Math.min(Math.floor(raw), MAX_WINDOW_MINUTES)
  } catch {
    return 0
  }
}

/**
 * Read the persisted digest settings, or `null` when no row exists (or D1 is
 * unavailable) — callers then fall back to the env value. Never throws.
 */
export async function getDigestSettings(
  ownerId: string
): Promise<DigestSettings | null> {
  try {
    const db = getDb()
    if (!db) return null
    // `.all()` (not `.first()`) so behavioral test fakes that only implement
    // run/all/bind — the shared health D1 fakes — exercise this store too.
    const result = await db
      .prepare(
        `SELECT enabled, target_json FROM ${TABLE} WHERE owner_id = ?1 AND channel = ?2 LIMIT 1`
      )
      .bind(ownerId, DIGEST_KEY)
      .all<D1DigestRow>()
    const row = (result.results ?? [])[0]
    if (!row) return null
    return {
      enabled: row.enabled === 1,
      windowMinutes: parseWindowMinutes(row.target_json),
    }
  } catch (err) {
    warn(`failed to read digest settings for owner ${ownerId}: ${err}`)
    return null
  }
}

/**
 * Upsert the digest settings. Returns the stored value on success, `null` on
 * any failure (e.g. no D1 binding) — never throws. The window is clamped to
 * `[0, ${MAX_WINDOW_MINUTES}]`.
 */
export async function setDigestSettings(
  ownerId: string,
  input: DigestSettings
): Promise<DigestSettings | null> {
  try {
    const db = getDb()
    if (!db) return null
    const windowMinutes = Number.isFinite(input.windowMinutes)
      ? Math.min(
          Math.max(0, Math.floor(input.windowMinutes)),
          MAX_WINDOW_MINUTES
        )
      : 0
    await db
      .prepare(
        `INSERT INTO ${TABLE} (owner_id, channel, enabled, min_severity, target_json, secret, updated_at)
         VALUES (?1, ?2, ?3, NULL, ?4, NULL, ?5)
         ON CONFLICT(owner_id, channel) DO UPDATE SET
           enabled = excluded.enabled,
           target_json = excluded.target_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        ownerId,
        DIGEST_KEY,
        input.enabled ? 1 : 0,
        JSON.stringify({ windowMinutes }),
        Date.now()
      )
      .run()
    return { enabled: input.enabled, windowMinutes }
  } catch (err) {
    warn(`failed to save digest settings for owner ${ownerId}: ${err}`)
    return null
  }
}

/**
 * Resolve the effective buffer window in minutes for the sweep: the persisted
 * D1 setting when a row exists (0 when it exists but is disabled), otherwise the
 * `HEALTH_ALERT_DIGEST_MINUTES` env fallback. `0` = time-window mode off.
 */
export async function resolveDigestWindowMinutes(
  ownerId = ''
): Promise<number> {
  const row = await getDigestSettings(ownerId)
  if (row) return row.enabled ? row.windowMinutes : 0
  return getServerDigestWindowMinutes()
}
