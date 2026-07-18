/**
 * Time-window digest buffer (feat #2663).
 *
 * When digest mode runs with a positive window (`HEALTH_ALERT_DIGEST_MINUTES` or
 * the UI setting), a NON-critical finding's groupable delivery entries (a Slack
 * / generic webhook, or a Telegram send) are parked here instead of dispatched
 * this tick, then flushed and grouped by a later sweep once `flush_after`
 * passes. Criticals never reach this store — they dispatch immediately.
 *
 * Each row is ONE serialized {@link BufferedDigestEntry}. On flush the sweep
 * takes every due row for its owner, groups them per target exactly like the
 * in-pass path, and deletes them.
 *
 * Follows the health D1 stores' contract: `CHM_CLOUD_D1` via
 * {@link getPlatformBindings}, everything best-effort — a missing binding (the
 * OSS default) or any D1 error resolves to `false`/`[]` and NEVER throws, so
 * with no D1 the sweep simply behaves as if time-window mode were off (in-pass
 * grouping still applies).
 */

import type { AlertPayload } from './adapters/types'

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'alert-digest-buffer'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-digest-buffer] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'alert_digest_buffer'

/** Sane cap so one flush can't return an unbounded row set. */
const MAX_FLUSH_ROWS = 500

/** A buffered Slack / generic-webhook delivery. */
export interface BufferedWebhookEntry {
  kind: 'webhook'
  url: string
  text: string
  payload: AlertPayload
  /** Ack-button key kept so a lone buffered Slack finding still renders it. */
  slackAck?: {
    hostId: number
    ruleId: string
    severity: 'warning' | 'critical'
  }
}

/** A buffered Telegram delivery. */
export interface BufferedTelegramEntry {
  kind: 'telegram'
  botToken: string
  chatId: string
  payload: AlertPayload
}

export type BufferedDigestEntry = BufferedWebhookEntry | BufferedTelegramEntry

interface D1BufferRow {
  entry_json: string
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function isBufferedEntry(v: unknown): v is BufferedDigestEntry {
  if (!v || typeof v !== 'object') return false
  const kind = (v as { kind?: unknown }).kind
  return kind === 'webhook' || kind === 'telegram'
}

/**
 * Park a batch of groupable delivery entries until `flushAfter` (epoch ms).
 * Returns `true` only when the rows were actually written (D1 present, no
 * error) — the caller uses that to decide whether the finding was buffered or
 * must fall back to immediate in-pass grouping. Never throws.
 */
export async function bufferDigestEntries(
  ownerId: string,
  entries: readonly BufferedDigestEntry[],
  flushAfter: number
): Promise<boolean> {
  if (entries.length === 0) return false
  try {
    const db = getDb()
    if (!db) return false
    const now = Date.now()
    const stmt = db.prepare(
      `INSERT INTO ${TABLE} (id, owner_id, flush_after, entry_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    for (const entry of entries) {
      await stmt
        .bind(
          crypto.randomUUID(),
          ownerId,
          flushAfter,
          JSON.stringify(entry),
          now
        )
        .run()
    }
    return true
  } catch (err) {
    warn(`failed to buffer ${entries.length} digest entries: ${err}`)
    return false
  }
}

/**
 * Take (read + delete) every buffered entry whose window has closed
 * (`flush_after <= now`) for an owner, oldest first. Returns `[]` when D1 is
 * unavailable or on any error. Never throws.
 */
export async function takeDueDigestEntries(
  ownerId: string,
  now: number
): Promise<BufferedDigestEntry[]> {
  try {
    const db = getDb()
    if (!db) return []
    const result = await db
      .prepare(
        `SELECT id, entry_json FROM ${TABLE}
         WHERE owner_id = ?1 AND flush_after <= ?2
         ORDER BY flush_after ASC, created_at ASC
         LIMIT ?3`
      )
      .bind(ownerId, now, MAX_FLUSH_ROWS)
      .all<D1BufferRow & { id: string }>()

    const rows = result.results ?? []
    if (rows.length === 0) return []

    // Delete what we're about to return so a later tick never re-flushes it.
    // Best-effort: a delete failure only risks a duplicate message, never a
    // lost one, and is swallowed like every other store error here.
    const ids = rows.map((r) => r.id)
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ')
    await db
      .prepare(`DELETE FROM ${TABLE} WHERE id IN (${placeholders})`)
      .bind(...ids)
      .run()

    const entries: BufferedDigestEntry[] = []
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.entry_json) as unknown
        if (isBufferedEntry(parsed)) entries.push(parsed)
      } catch {
        // Skip a corrupt row rather than abort the whole flush.
      }
    }
    return entries
  } catch (err) {
    warn(`failed to take due digest entries for owner ${ownerId}: ${err}`)
    return []
  }
}
