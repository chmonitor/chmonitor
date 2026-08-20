/**
 * D1-backed store for OAuth device-code grants (`chm auth login`).
 *
 * Pattern mirrors `lib/slack/install-store.ts`: `CHM_CLOUD_D1` binding via
 * `getPlatformBindings()`, fail-open (never throw to callers — return
 * null/false/error codes). `user_code` is always stored UPPERCASE.
 */

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[device-code-store] ${msg}`, {
    component: 'device-code-store',
  })

const TABLE = 'oauth_device_codes'

// Kept in sync with db/conversations-migrations/0030_oauth_device_codes.sql.
const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    device_code   TEXT PRIMARY KEY,
    user_code     TEXT NOT NULL UNIQUE,
    client_id     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    interval_sec  INTEGER NOT NULL DEFAULT 5,
    approved_at   INTEGER,
    user_id       TEXT,
    consumed_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_user_code
    ON ${TABLE} (user_code);
  CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_expires
    ON ${TABLE} (expires_at);
`

export interface DeviceCodeRow {
  deviceCode: string
  userCode: string
  clientId: string
  createdAt: number
  expiresAt: number
  intervalSec: number
  approvedAt: number | null
  userId: string | null
  consumedAt: number | null
}

interface D1DeviceCodeRow {
  device_code: string
  user_code: string
  client_id: string
  created_at: number
  expires_at: number
  interval_sec: number
  approved_at: number | null
  user_id: string | null
  consumed_at: number | null
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function rowToRecord(row: D1DeviceCodeRow): DeviceCodeRecord {
  return {
    deviceCode: row.device_code,
    userCode: row.user_code,
    clientId: row.client_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    intervalSec: row.interval_sec,
    approvedAt: row.approved_at,
    userId: row.user_id,
    consumedAt: row.consumed_at,
  }
}

let ensured = false

async function ensureTable(db: D1Database): Promise<boolean> {
  if (ensured) return true
  try {
    // D1 prepare().run() accepts one statement; run each separately.
    for (const stmt of ENSURE_TABLE_SQL.split(';')
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.prepare(stmt).run()
    }
    ensured = true
    return true
  } catch (err) {
    warn(`failed to ensure ${TABLE}: ${err}`)
    return false
  }
}

/** True when the cloud D1 binding is present (device login can persist codes). */
export function deviceLoginAvailable(): boolean {
  return getDb() != null
}

export async function insertDeviceCode(input: {
  deviceCode: string
  userCode: string
  clientId: string
  createdAt: number
  expiresAt: number
  intervalSec?: number
}): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) {
      warn('no CHM_CLOUD_D1 binding — cannot persist device code')
      return false
    }
    if (!(await ensureTable(db))) return false

    const userCode = input.userCode.trim().toUpperCase()
    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (device_code, user_code, client_id, created_at, expires_at, interval_sec,
            approved_at, user_id, consumed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL)`
      )
      .bind(
        input.deviceCode,
        userCode,
        input.clientId,
        input.createdAt,
        input.expiresAt,
        input.intervalSec ?? 5
      )
      .run()
    return true
  } catch (err) {
    warn(`failed to insert device code: ${err}`)
    return false
  }
}

export async function getByDeviceCode(
  deviceCode: string
): Promise<DeviceCodeRecord | null> {
  try {
    const db = getDb()
    if (!db) return null
    if (!(await ensureTable(db))) return null
    const row = await db
      .prepare(`SELECT * FROM ${TABLE} WHERE device_code = ?1`)
      .bind(deviceCode)
      .first<D1DeviceCodeRow>()
    return row ? rowToRecord(row) : null
  } catch (err) {
    warn(`failed to get by device_code: ${err}`)
    return null
  }
}

export async function getByUserCode(
  userCode: string
): Promise<DeviceCodeRecord | null> {
  try {
    const db = getDb()
    if (!db) return null
    if (!(await ensureTable(db))) return null
    const normalized = userCode.trim().toUpperCase()
    const row = await db
      .prepare(`SELECT * FROM ${TABLE} WHERE user_code = ?1`)
      .bind(normalized)
      .first<D1DeviceCodeRow>()
    return row ? rowToRecord(row) : null
  } catch (err) {
    warn(`failed to get by user_code: ${err}`)
    return null
  }
}

export type ApproveUserCodeResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'unavailable'
        | 'not_found'
        | 'expired'
        | 'consumed'
        | 'already_approved'
    }

/**
 * Bind an authenticated user to a pending user_code. Never throws.
 */
export async function approveUserCode(
  userCode: string,
  userId: string
): Promise<ApproveUserCodeResult> {
  try {
    const db = getDb()
    if (!db) return { ok: false, error: 'unavailable' }
    if (!(await ensureTable(db))) return { ok: false, error: 'unavailable' }

    const record = await getByUserCode(userCode)
    if (!record) return { ok: false, error: 'not_found' }
    if (record.consumedAt != null) return { ok: false, error: 'consumed' }
    if (record.expiresAt <= Date.now()) return { ok: false, error: 'expired' }
    if (record.approvedAt != null)
      return { ok: false, error: 'already_approved' }

    const now = Date.now()
    await db
      .prepare(
        `UPDATE ${TABLE}
         SET approved_at = ?1, user_id = ?2
         WHERE user_code = ?3 AND approved_at IS NULL AND consumed_at IS NULL`
      )
      .bind(now, userId, record.userCode)
      .run()
    return { ok: true }
  } catch (err) {
    warn(`failed to approve user_code: ${err}`)
    return { ok: false, error: 'unavailable' }
  }
}

/** Mark a device_code as consumed after minting the access token. */
export async function markConsumed(deviceCode: string): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false
    if (!(await ensureTable(db))) return false
    const now = Date.now()
    await db
      .prepare(
        `UPDATE ${TABLE}
         SET consumed_at = ?1
         WHERE device_code = ?2 AND consumed_at IS NULL`
      )
      .bind(now, deviceCode)
      .run()
    return true
  } catch (err) {
    warn(`failed to mark consumed: ${err}`)
    return false
  }
}
