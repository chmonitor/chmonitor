import { useCallback, useEffect, useState } from 'react'

/**
 * Query Favorites — local bookmark store for saved SQL queries.
 *
 * Deliberately separate from useQueryHistory: history is ephemeral (auto-evicts,
 * records every run), favorites are intentional named bookmarks (never evicted,
 * user-titled, tagged).
 *
 * The store is pluggable for future team-sharing: FavoritesBackend defines the
 * contract; LocalFavoritesBackend fulfills it from localStorage.
 */

export interface QueryFavorite {
  id: string
  title: string
  sql: string
  tags: string[]
  hostId: number
  database: string | null
  createdAt: number
  /** Shareable URL. e.g. /sql?q=<encoded>&host=<hostId> */
  shareUrl: string
}

export interface FavoritesBackend {
  list(): QueryFavorite[]
  save(entry: Omit<QueryFavorite, 'id' | 'createdAt'>): QueryFavorite
  remove(id: string): void
  update(
    id: string,
    patch: Partial<Pick<QueryFavorite, 'title' | 'tags'>>
  ): void
  isFavorited(sql: string): boolean
}

const STORAGE_KEY = 'chm.sql.favorites.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike {
  if (typeof window !== 'undefined') return window.localStorage
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
}

function buildShareUrl(sql: string, hostId: number): string {
  if (typeof window === 'undefined') return ''
  const base = `${window.location.origin}/sql`
  const params = new URLSearchParams({ q: sql, host: String(hostId) })
  return `${base}?${params.toString()}`
}

/** Tiny non-cryptographic hash for stable-ish ids. */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}

export class LocalFavoritesBackend implements FavoritesBackend {
  private s: StorageLike

  constructor(storage?: StorageLike) {
    this.s = storage ?? defaultStorage()
  }

  private read(): QueryFavorite[] {
    try {
      const raw = this.s.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (e): e is QueryFavorite =>
          e &&
          typeof e.id === 'string' &&
          typeof e.sql === 'string' &&
          typeof e.createdAt === 'number'
      )
    } catch {
      return []
    }
  }

  /** Returns false on quota/serialization failure so callers can surface it. */
  private write(entries: QueryFavorite[]): boolean {
    try {
      this.s.setItem(STORAGE_KEY, JSON.stringify(entries))
      return true
    } catch {
      return false
    }
  }

  list(): QueryFavorite[] {
    return this.read()
  }

  save(entry: Omit<QueryFavorite, 'id' | 'createdAt'>): QueryFavorite {
    const createdAt = Date.now()
    const id = `fav-${createdAt}-${Math.abs(hashStr(entry.sql)) % 100000}`
    const shareUrl = entry.shareUrl || buildShareUrl(entry.sql, entry.hostId)
    const fav: QueryFavorite = { ...entry, id, createdAt, shareUrl }
    const prev = this.read()
    if (!this.write([fav, ...prev])) {
      throw new Error(
        'Could not save favorite: browser storage is unavailable or full'
      )
    }
    return fav
  }

  remove(id: string): void {
    this.write(this.read().filter((e) => e.id !== id))
  }

  update(
    id: string,
    patch: Partial<Pick<QueryFavorite, 'title' | 'tags'>>
  ): void {
    this.write(this.read().map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  isFavorited(sql: string): boolean {
    const trimmed = sql.trim()
    return this.read().some((e) => e.sql.trim() === trimmed)
  }
}

const backend = new LocalFavoritesBackend()

export function useQueryFavorites() {
  const [favorites, setFavorites] = useState<QueryFavorite[]>(() =>
    backend.list()
  )

  // Sync across tabs/windows.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setFavorites(backend.list())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const refresh = useCallback(() => {
    setFavorites(backend.list())
  }, [])

  const save = useCallback(
    (entry: Omit<QueryFavorite, 'id' | 'createdAt'>) => {
      backend.save(entry)
      refresh()
    },
    [refresh]
  )

  const remove = useCallback(
    (id: string) => {
      backend.remove(id)
      refresh()
    },
    [refresh]
  )

  const update = useCallback(
    (id: string, patch: Partial<Pick<QueryFavorite, 'title' | 'tags'>>) => {
      backend.update(id, patch)
      refresh()
    },
    [refresh]
  )

  const isFavorited = useCallback((sql: string) => backend.isFavorited(sql), [])

  return { favorites, save, remove, update, isFavorited }
}
