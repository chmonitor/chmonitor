/**
 * Device-code grant store for `chm auth login` (RFC 8628).
 *
 * Prefers D1 (`CHM_CLOUD_D1`) when bound; otherwise an in-memory Map suitable
 * for single-node self-hosted (Docker). Multi-replica OSS without D1 should
 * keep `CHM_DEVICE_LOGIN=false` (default) or terminate SSL sticky to one pod.
 *
 * Pattern mirrors `lib/slack/install-store.ts`: fail-open (never throw to
 * callers — return null/false/error codes). `user_code` is always UPPERCASE.
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

export interface DeviceCodeRecord {
  deviceCode: string
  userCode: string
  clientId: string
  createdAt: number
  expiresAt: number
  intervalSec: number
  approvedAt: number | null
  userId: string | null
  consumedAt: number | null
  /** Last RFC 8628 token poll timestamp (ms), for slow_down enforcement. */
  lastPollAt: number | null
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
  last_poll_at: number | null
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
    lastPollAt: row.last_poll_at ?? null,
  }
}

let ensured = false
let lastPollColumnEnsured = false

async function ensureLastPollColumn(db: D1Database): Promise<void> {
  if (lastPollColumnEnsured) return
  try {
    await db
      .prepare(`ALTER TABLE ${TABLE} ADD COLUMN last_poll_at INTEGER`)
      .run()
  } catch {
    // Column likely already exists on upgraded deployments.
  }
  lastPollColumnEnsured = true
}

async function ensureTable(db: D1Database): Promise<boolean> {
  if (ensured) return true
  try {
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

// ── In-memory fallback (single-node self-hosted) ───────────────────────────

const memoryByDevice = new Map<string, DeviceCodeRecord>()
const memoryByUser = new Map<string, string>()

function memoryPurgeExpired(now = Date.now()): void {
  for (const [deviceCode, record] of memoryByDevice) {
    if (record.expiresAt <= now) {
      memoryByDevice.delete(deviceCode)
      memoryByUser.delete(record.userCode)
    }
  }
}

/** Test-only: clear the in-memory map between cases. */
export function __resetDeviceCodeMemoryForTests(): void {
  memoryByDevice.clear()
  memoryByUser.clear()
  ensured = false
  lastPollColumnEnsured = false
}

/**
 * True when a backend can persist device codes (D1 or memory).
 * Prefer {@link isDeviceLoginEnabled} from `device-login-config` for the
 * product gate — this only answers "can we store?".
 */
export function deviceLoginAvailable(): boolean {
  return true
}

export function deviceCodeStoreKind(): 'd1' | 'memory' {
  return getDb() != null ? 'd1' : 'memory'
}

export async function insertDeviceCode(input: {
  deviceCode: string
  userCode: string
  clientId: string
  createdAt: number
  expiresAt: number
  intervalSec?: number
}): Promise<boolean> {
  const userCode = input.userCode.trim().toUpperCase()
  const record: DeviceCodeRecord = {
    deviceCode: input.deviceCode,
    userCode,
    clientId: input.clientId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    intervalSec: input.intervalSec ?? 5,
    approvedAt: null,
    userId: null,
    consumedAt: null,
    lastPollAt: null,
  }

  try {
    const db = getDb()
    if (db) {
      if (!(await ensureTable(db))) return false
      await ensureLastPollColumn(db)
      await db
        .prepare(
          `INSERT INTO ${TABLE}
             (device_code, user_code, client_id, created_at, expires_at, interval_sec,
              approved_at, user_id, consumed_at, last_poll_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL)`
        )
        .bind(
          record.deviceCode,
          record.userCode,
          record.clientId,
          record.createdAt,
          record.expiresAt,
          record.intervalSec
        )
        .run()
      return true
    }

    memoryPurgeExpired()
    if (memoryByUser.has(userCode)) {
      warn('memory store: duplicate user_code')
      return false
    }
    memoryByDevice.set(record.deviceCode, record)
    memoryByUser.set(userCode, record.deviceCode)
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
    if (db) {
      if (!(await ensureTable(db))) return null
      const row = await db
        .prepare(`SELECT * FROM ${TABLE} WHERE device_code = ?1`)
        .bind(deviceCode)
        .first<D1DeviceCodeRow>()
      return row ? rowToRecord(row) : null
    }

    return memoryByDevice.get(deviceCode) ?? null
  } catch (err) {
    warn(`failed to get by device_code: ${err}`)
    return null
  }
}

export async function getByUserCode(
  userCode: string
): Promise<DeviceCodeRecord | null> {
  try {
    const normalized = userCode.trim().toUpperCase()
    const db = getDb()
    if (db) {
      if (!(await ensureTable(db))) return null
      const row = await db
        .prepare(`SELECT * FROM ${TABLE} WHERE user_code = ?1`)
        .bind(normalized)
        .first<D1DeviceCodeRow>()
      return row ? rowToRecord(row) : null
    }

    const deviceCode = memoryByUser.get(normalized)
    if (!deviceCode) return null
    return memoryByDevice.get(deviceCode) ?? null
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
 * Bind an authenticated (or device-only) user to a pending user_code.
 * Never throws.
 */
export async function approveUserCode(
  userCode: string,
  userId: string
): Promise<ApproveUserCodeResult> {
  try {
    const record = await getByUserCode(userCode)
    if (!record) return { ok: false, error: 'not_found' }
    if (record.consumedAt != null) return { ok: false, error: 'consumed' }
    if (record.expiresAt <= Date.now()) return { ok: false, error: 'expired' }
    if (record.approvedAt != null)
      return { ok: false, error: 'already_approved' }

    const now = Date.now()
    const db = getDb()
    if (db) {
      if (!(await ensureTable(db))) return { ok: false, error: 'unavailable' }
      await db
        .prepare(
          `UPDATE ${TABLE}
           SET approved_at = ?1, user_id = ?2
           WHERE user_code = ?3 AND approved_at IS NULL AND consumed_at IS NULL`
        )
        .bind(now, userId, record.userCode)
        .run()
      return { ok: true }
    }

    const current = memoryByDevice.get(record.deviceCode)
    if (!current) return { ok: false, error: 'not_found' }
    if (current.approvedAt != null)
      return { ok: false, error: 'already_approved' }
    memoryByDevice.set(record.deviceCode, {
      ...current,
      approvedAt: now,
      userId,
    })
    return { ok: true }
  } catch (err) {
    warn(`failed to approve user_code: ${err}`)
    return { ok: false, error: 'unavailable' }
  }
}

export type DeviceCodePollResult = 'ok' | 'slow_down'

/**
 * RFC 8628 poll-interval gate for pending device codes. Updates lastPollAt
 * when the caller may proceed; returns `slow_down` when polled too soon.
 */
export async function enforceDeviceCodePollInterval(
  record: DeviceCodeRecord
): Promise<DeviceCodePollResult> {
  const now = Date.now()
  if (record.lastPollAt != null) {
    const elapsedSec = (now - record.lastPollAt) / 1000
    if (elapsedSec < record.intervalSec) return 'slow_down'
  }

  try {
    const db = getDb()
    if (db) {
      if (!(await ensureTable(db))) return 'ok'
      await ensureLastPollColumn(db)
      await db
        .prepare(`UPDATE ${TABLE} SET last_poll_at = ?1 WHERE device_code = ?2`)
        .bind(now, record.deviceCode)
        .run()
      return 'ok'
    }

    const current = memoryByDevice.get(record.deviceCode)
    if (current) {
      memoryByDevice.set(record.deviceCode, { ...current, lastPollAt: now })
    }
    return 'ok'
  } catch (err) {
    warn(`failed to record device_code poll: ${err}`)
    return 'ok'
  }
}

/** Mark a device_code as consumed after minting the access token. */
export async function markConsumed(deviceCode: string): Promise<boolean> {
  try {
    const now = Date.now()
    const db = getDb()
    if (db) {
      if (!(await ensureTable(db))) return false
      await db
        .prepare(
          `UPDATE ${TABLE}
           SET consumed_at = ?1
           WHERE device_code = ?2 AND consumed_at IS NULL`
        )
        .bind(now, deviceCode)
        .run()
      return true
    }

    const current = memoryByDevice.get(deviceCode)
    if (!current || current.consumedAt != null) return false
    memoryByDevice.set(deviceCode, { ...current, consumedAt: now })
    return true
  } catch (err) {
    warn(`failed to mark consumed: ${err}`)
    return false
  }
}
