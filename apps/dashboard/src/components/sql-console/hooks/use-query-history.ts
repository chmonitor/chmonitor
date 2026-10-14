import { useCallback, useEffect, useState } from 'react'

/**
 * Local (per-browser) SQL query history, persisted to localStorage.
 *
 * This is the "Mine" side of the SQL Console history. The "Server" side reads
 * system.query_log via the API. Kept deliberately simple: a capped, de-duped
 * list of recently run queries plus a pinned set for favorites.
 */

export interface QueryHistoryEntry {
  /** Stable id (timestamp-based) used as React key and for pin/remove. */
  id: string
  sql: string
  hostId: number
  database: string | null
  /** Epoch ms when the query was run. */
  ts: number
  /** Execution duration in ms, if known. */
  durationMs?: number
  /** Row count returned, if known. */
  rows?: number
  ok: boolean
  /** User-pinned favorite. Pinned entries are never evicted by the cap. */
  pinned?: boolean
}

const STORAGE_KEY = 'chm.sql.history.v1'
const MAX_ENTRIES = 100

function readStorage(): QueryHistoryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is QueryHistoryEntry =>
        e && typeof e.sql === 'string' && typeof e.ts === 'number'
    )
  } catch {
    return []
  }
}

function writeStorage(entries: QueryHistoryEntry[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Quota or serialization failure — history is best-effort, ignore.
  }
}

export function useQueryHistory() {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>(readStorage)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEntries(readStorage())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const persist = useCallback((next: QueryHistoryEntry[]) => {
    setEntries(next)
    writeStorage(next)
  }, [])

  const add = useCallback(
    (entry: Omit<QueryHistoryEntry, 'id' | 'ts'> & { ts?: number }) => {
      setEntries((prev) => {
        const sql = entry.sql.trim()
        if (!sql) return prev
        const ts = entry.ts ?? Date.now()
        const id = `${ts}-${Math.abs(hashSql(sql)) % 100000}`
        // Drop any prior unpinned entry with identical SQL on the same host so
        // re-running a query bubbles it to the top instead of duplicating.
        const deduped = prev.filter(
          (e) =>
            e.pinned || !(e.sql.trim() === sql && e.hostId === entry.hostId)
        )
        const next: QueryHistoryEntry[] = [
          { ...entry, sql, id, ts },
          ...deduped,
        ]
        // Enforce cap, but never evict pinned entries.
        const pinned = next.filter((e) => e.pinned)
        const unpinned = next.filter((e) => !e.pinned)
        const capped = [
          ...pinned,
          ...unpinned.slice(0, Math.max(0, MAX_ENTRIES - pinned.length)),
        ]
        writeStorage(capped)
        return capped
      })
    },
    []
  )

  const remove = useCallback(
    (id: string) => {
      persist(entries.filter((e) => e.id !== id))
    },
    [entries, persist]
  )

  const togglePin = useCallback(
    (id: string) => {
      persist(
        entries.map((e) => (e.id === id ? { ...e, pinned: !e.pinned } : e))
      )
    },
    [entries, persist]
  )

  const clear = useCallback(() => {
    // Clearing keeps pinned favorites — those are deliberate saves.
    persist(entries.filter((e) => e.pinned))
  }, [entries, persist])

  return { entries, add, remove, togglePin, clear }
}

/** Tiny non-cryptographic hash for stable-ish ids from SQL text. */
function hashSql(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}
