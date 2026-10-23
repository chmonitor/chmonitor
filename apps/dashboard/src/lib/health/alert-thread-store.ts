/**
 * Thread roots for alert episodes (#4049).
 *
 * An episode is one (host, rule, channel destination) from its first alert to
 * its recovery. The first alert's message id on a channel that can thread
 * (native Matrix, Telegram) is kept here so reminders, escalations and the
 * recovery reply under it instead of posting a new top-level message.
 *
 * Follows the health stores' contract: `getHealthDb()` (D1, else Postgres),
 * and everything is best-effort. With no backend or on any error, reads return
 * an empty map and writes do nothing, so alerts go out unthreaded exactly as
 * before. Never throws.
 */

import type { HealthSqlDb } from './sql-db'

import { getHealthDb } from './resolve-store'
import { ErrorLogger } from '@chm/logger'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[alert-thread-store] ${msg}`, {
    component: 'alert-thread-store',
  })

/** Cap on one owner's rows read per sweep. */
const MAX_ROWS = 5000

export const LOAD_THREAD_ROOTS_SQL = `SELECT thread_key, root_id FROM alert_thread_roots
   WHERE owner_id = ?1 LIMIT ?2`

/** `replace` = a new episode's first message; otherwise keep an existing root. */
export const UPSERT_THREAD_ROOT_SQL = `INSERT INTO alert_thread_roots (owner_id, thread_key, host_id, rule_id, root_id, created_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6)
   ON CONFLICT (owner_id, thread_key) DO UPDATE SET
     root_id = excluded.root_id,
     created_at = excluded.created_at`

export const INSERT_THREAD_ROOT_SQL = `INSERT INTO alert_thread_roots (owner_id, thread_key, host_id, rule_id, root_id, created_at)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6)
   ON CONFLICT (owner_id, thread_key) DO NOTHING`

export const DELETE_THREAD_ROOT_SQL = `DELETE FROM alert_thread_roots
   WHERE owner_id = ?1 AND thread_key = ?2`

export const DELETE_EPISODE_THREAD_ROOTS_SQL = `DELETE FROM alert_thread_roots
   WHERE owner_id = ?1 AND host_id = ?2 AND rule_id = ?3`

/**
 * The key for one episode on one destination: a hash, so no bot or access
 * token ever lands in a row. `destination` holds every part that tells two
 * destinations apart (for Matrix: homeserver, room and token).
 */
export async function alertThreadKey(parts: {
  hostId: number | undefined
  ruleId: string
  channel: 'matrix' | 'telegram'
  destination: readonly string[]
}): Promise<string> {
  const data = new TextEncoder().encode(
    [
      parts.channel,
      String(parts.hostId ?? ''),
      parts.ruleId,
      ...parts.destination,
    ].join('\u0000')
  )
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

function getDb(): HealthSqlDb | null {
  return getHealthDb()
}

/** Every stored root for an owner, keyed by thread key. Never throws. */
export async function loadThreadRoots(
  ownerId: string
): Promise<Map<string, string>> {
  const roots = new Map<string, string>()
  try {
    const db = getDb()
    if (!db) return roots
    const result = await db
      .prepare(LOAD_THREAD_ROOTS_SQL)
      .bind(ownerId, MAX_ROWS)
      .all<{ thread_key: string; root_id: string }>()
    for (const row of result.results ?? []) {
      roots.set(row.thread_key, row.root_id)
    }
  } catch (err) {
    warn(`failed to load thread roots: ${err}`)
  }
  return roots
}

/**
 * Store an episode's root message id. `replace` overwrites a leftover row (a
 * recovery that was never sent leaves one behind); otherwise an existing root
 * wins. Never throws.
 */
export async function saveThreadRoot(
  ownerId: string,
  root: { threadKey: string; hostId: number; ruleId: string; rootId: string },
  options: { replace: boolean }
): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await db
      .prepare(
        options.replace ? UPSERT_THREAD_ROOT_SQL : INSERT_THREAD_ROOT_SQL
      )
      .bind(
        ownerId,
        root.threadKey,
        root.hostId,
        root.ruleId,
        root.rootId,
        Date.now()
      )
      .run()
  } catch (err) {
    warn(`failed to save a thread root: ${err}`)
  }
}

/** Forget an episode's root (it recovered). Never throws. */
export async function deleteThreadRoot(
  ownerId: string,
  threadKey: string
): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await db.prepare(DELETE_THREAD_ROOT_SQL).bind(ownerId, threadKey).run()
  } catch (err) {
    warn(`failed to delete a thread root: ${err}`)
  }
}

/**
 * Forget every destination's root for one (host, rule): a new episode began,
 * so nothing may thread under the previous one. Never throws.
 */
export async function deleteEpisodeThreadRoots(
  ownerId: string,
  hostId: number,
  ruleId: string
): Promise<void> {
  try {
    const db = getDb()
    if (!db) return
    await db
      .prepare(DELETE_EPISODE_THREAD_ROOTS_SQL)
      .bind(ownerId, hostId, ruleId)
      .run()
  } catch (err) {
    warn(`failed to delete an episode's thread roots: ${err}`)
  }
}
