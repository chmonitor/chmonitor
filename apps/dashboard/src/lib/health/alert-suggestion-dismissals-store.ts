/**
 * D1-backed dismissal store for alert suggestions (issue #2667).
 *
 * A dismissed suggestion must STAY dismissed across recomputes, so we persist
 * the stable suggestion key (`${metric}:host:${hostId}`) per owner — mirroring
 * the AI-insights stable-key dismissal pattern, but server-side in D1 (shared
 * `CHM_CLOUD_D1` binding) rather than per-browser localStorage, because the
 * suggestion set is computed server-side.
 *
 * Ownership is scoped exactly like `custom-rules-store.ts` (`owner_id`): the
 * fixed `oss` tenant when Clerk is unconfigured, the Clerk user id otherwise.
 *
 * READ path fails OPEN ({@link listDismissedSuggestionKeys} → empty set on any
 * error) so a missing binding just means "nothing dismissed yet" and the GET
 * endpoint keeps working. WRITE path fails LOUD
 * ({@link dismissSuggestion} throws {@link SuggestionDismissalStoreError}) so the
 * POST endpoint can return an honest 501/500 instead of pretending a dismissal
 * stuck when it didn't. The table is created lazily (idempotent DDL) in addition
 * to the `0020_alert_suggestion_dismissals` migration.
 */

import { debug } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'
const TABLE = 'alert_suggestion_dismissals'

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    owner_id TEXT NOT NULL,
    suggestion_key TEXT NOT NULL,
    dismissed_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, suggestion_key)
  )
`

export class SuggestionDismissalStoreError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_CONFIGURED' | 'STORAGE_ERROR',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'SuggestionDismissalStoreError'
  }
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database(D1_BINDING_NAME)
}

// Single-flight lazy migration: idempotent DDL runs at most once per process; a
// failure clears the memo so the next call retries.
let migration: Promise<void> | null = null
function ensureMigrated(db: D1Database): Promise<void> {
  if (!migration) {
    migration = db
      .prepare(MIGRATION_SQL)
      .run()
      .then(() => undefined)
      .catch((err) => {
        migration = null
        throw err
      })
  }
  return migration
}

/**
 * All suggestion keys the owner has dismissed. Fails OPEN: any error (no
 * binding, unmigrated table, query failure) resolves to an empty set so the
 * compute path degrades to "show everything" rather than throwing.
 */
export async function listDismissedSuggestionKeys(
  ownerId: string
): Promise<Set<string>> {
  try {
    const db = getDb()
    if (!db) return new Set()
    await ensureMigrated(db)
    const result = await db
      .prepare(`SELECT suggestion_key FROM ${TABLE} WHERE owner_id = ?1`)
      .bind(ownerId)
      .all<{ suggestion_key: string }>()
    return new Set((result.results ?? []).map((r) => r.suggestion_key))
  } catch (err) {
    debug('[alert-suggestion-dismissals] read failed', String(err))
    return new Set()
  }
}

/**
 * Persist a dismissal (idempotent). Fails LOUD so the API can report an honest
 * error when D1 is unavailable — a dismissal that silently no-ops would let the
 * card immediately resurrect on the next poll.
 */
export async function dismissSuggestion(
  ownerId: string,
  key: string
): Promise<void> {
  const db = getDb()
  if (!db) {
    throw new SuggestionDismissalStoreError(
      `${D1_BINDING_NAME} binding not found. Dismissing suggestions requires a configured D1 database.`,
      'NOT_CONFIGURED'
    )
  }
  try {
    await ensureMigrated(db)
    await db
      .prepare(
        `INSERT INTO ${TABLE} (owner_id, suggestion_key, dismissed_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT (owner_id, suggestion_key) DO NOTHING`
      )
      .bind(ownerId, key, Date.now())
      .run()
  } catch (err) {
    throw new SuggestionDismissalStoreError(
      `Failed to persist suggestion dismissal: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'STORAGE_ERROR',
      err
    )
  }
}

/** Test-only: reset the lazy-migration memo so the next call re-runs DDL. */
export function _resetSuggestionDismissalMigration(): void {
  migration = null
}
