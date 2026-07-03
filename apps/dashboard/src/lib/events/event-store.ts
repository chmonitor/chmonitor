/**
 * Inbound event store — D1 persistence for normalized events (`event_log`).
 *
 * Reads and writes degrade gracefully: when the CHM_CLOUD_D1 binding is absent
 * (local dev, self-host) or the table does not yet exist, functions return safe
 * defaults (false / empty / 0) so OSS deployments are never broken.
 *
 * Schema: see src/db/conversations-migrations/0010_event_log.sql
 */

import type { NormalizedEvent, StoredEvent } from './types'

import { getPlatformBindings } from '@chm/platform'

/** Inbound events are retained ~30 days (see plans/36-inbound-event-bus-queues.md). */
export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

interface EventLogRow {
  dedup_hash: string
  id: string
  source: string
  severity: string
  resource: string
  title: string
  body: string | null
  labels: string
  count: number
  received_at: number
  last_seen: number
}

function rowToStoredEvent(row: EventLogRow): StoredEvent {
  let labels: Record<string, string> = {}
  try {
    const parsed = JSON.parse(row.labels) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      labels = parsed as Record<string, string>
    }
  } catch {
    // Malformed labels JSON — degrade to no labels rather than fail the read.
  }

  return {
    id: row.id,
    source: row.source as StoredEvent['source'],
    severity: row.severity as StoredEvent['severity'],
    resource: row.resource,
    title: row.title,
    body: row.body,
    labels,
    receivedAt: row.received_at,
    dedupHash: row.dedup_hash,
    count: row.count,
    lastSeen: row.last_seen,
  }
}

/**
 * Upsert a normalized event by its dedup_hash: a first occurrence inserts a
 * new row; a repeat within the retention window bumps `count`/`last_seen` and
 * refreshes `body` (the latest occurrence's detail) rather than duplicating.
 * Returns false when D1 is unavailable or the write failed — callers must
 * treat that as "not persisted", never throw.
 */
export async function upsertEvent(event: NormalizedEvent): Promise<boolean> {
  const db = getDb()
  if (!db) return false
  try {
    await db
      .prepare(
        `INSERT INTO event_log
           (dedup_hash, id, source, severity, resource, title, body, labels, count, received_at, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)
         ON CONFLICT(dedup_hash) DO UPDATE SET
           count     = event_log.count + 1,
           last_seen = excluded.last_seen,
           body      = excluded.body`
      )
      .bind(
        event.dedupHash,
        event.id,
        event.source,
        event.severity,
        event.resource,
        event.title,
        event.body,
        JSON.stringify(event.labels),
        event.receivedAt
      )
      .run()
    return true
  } catch {
    // Swallow: a missing table or transient D1 error must not break ingest.
    return false
  }
}

export interface ListEventsFilters {
  source?: string
  severity?: string
  /** Only return events last seen at or after this instant (ms). */
  sinceMs?: number
  /** Default/max 500; defaults to the last {@link EVENT_RETENTION_MS} window. */
  limit?: number
}

/**
 * List stored events, most-recently-seen first. Defaults to the ~30d
 * retention window even before {@link pruneEventsOlderThan} has run, so the
 * UI never surfaces stale rows a periodic prune hasn't caught up to yet.
 * Returns an empty array when D1 is unavailable.
 */
export async function listEvents(
  filters: ListEventsFilters = {}
): Promise<StoredEvent[]> {
  const db = getDb()
  if (!db) return []

  const sinceMs = filters.sinceMs ?? Date.now() - EVENT_RETENTION_MS
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500)

  const clauses: string[] = ['last_seen >= ?1']
  const args: unknown[] = [sinceMs]
  if (filters.source) {
    args.push(filters.source)
    clauses.push(`source = ?${args.length}`)
  }
  if (filters.severity) {
    args.push(filters.severity)
    clauses.push(`severity = ?${args.length}`)
  }

  try {
    const result = await db
      .prepare(
        `SELECT * FROM event_log WHERE ${clauses.join(' AND ')} ORDER BY last_seen DESC LIMIT ${limit}`
      )
      .bind(...args)
      .all<EventLogRow>()
    return (result.results ?? []).map(rowToStoredEvent)
  } catch {
    // Missing table (migration not yet applied) or transient D1 error.
    return []
  }
}

/**
 * Hard-delete events last seen before `cutoffMs`. Returns the number of rows
 * deleted, or 0 when D1 is unavailable / the delete failed. Not currently
 * wired to a cron trigger — see plans/36-inbound-event-bus-queues.md and the
 * PR notes for the follow-up (retention today is enforced at read time by
 * {@link listEvents}'s default window; this is the storage-reclamation half).
 */
export async function pruneEventsOlderThan(cutoffMs: number): Promise<number> {
  const db = getDb()
  if (!db) return 0
  try {
    const result = await db
      .prepare('DELETE FROM event_log WHERE last_seen < ?1')
      .bind(cutoffMs)
      .run()
    return result.meta?.changes ?? 0
  } catch {
    return 0
  }
}
