/**
 * Pinned favorite menu items — browser-local only (issue #2769).
 *
 * Persists hrefs in pin order to localStorage. Device-level, no server/DB
 * storage: works signed-out and in OSS mode. Stale hrefs (a pinned route that
 * got renamed or removed) are tolerated by the reader
 * (`lib/menu/derive-favorites.ts`), not here — this module only persists the
 * raw href list.
 *
 * Same external-store shape as `lib/billing/paywall-store.ts`: a module-level
 * snapshot + listener set, read reactively via `useSyncExternalStore`
 * (`hooks/use-favorites.ts`). Mirrors the localStorage-guard style of
 * `lib/insights/dismissed-insights.ts`.
 */

const STORAGE_KEY = 'chm-pinned-favorites'

let hrefs: string[] = []
let loaded = false
const listeners = new Set<() => void>()

function load(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function ensureLoaded(): void {
  if (loaded) return
  hrefs = load()
  loaded = true
}

function persist(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hrefs))
  } catch {
    // Silently fail if localStorage is full or disabled.
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** Pinned hrefs in pin order (oldest pin first). */
export function getFavoriteHrefs(): string[] {
  ensureLoaded()
  return hrefs
}

export function isFavoriteHref(href: string): boolean {
  return getFavoriteHrefs().includes(href)
}

export function pinFavorite(href: string): void {
  ensureLoaded()
  if (hrefs.includes(href)) return
  hrefs = [...hrefs, href]
  persist()
  emit()
}

export function unpinFavorite(href: string): void {
  ensureLoaded()
  if (!hrefs.includes(href)) return
  hrefs = hrefs.filter((h) => h !== href)
  persist()
  emit()
}

export function toggleFavorite(href: string): void {
  if (isFavoriteHref(href)) {
    unpinFavorite(href)
  } else {
    pinFavorite(href)
  }
}

export function subscribeFavorites(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Stable reference for `useSyncExternalStore` — only reassigned on change. */
export function getFavoritesSnapshot(): string[] {
  return getFavoriteHrefs()
}

const EMPTY_FAVORITES: string[] = []

/** SSR/prerender snapshot — always empty; the store never mutates server-side. */
export function getFavoritesServerSnapshot(): string[] {
  return EMPTY_FAVORITES
}

/** Test-only: reset in-memory + persisted state between test cases. */
export function __resetFavoritesForTests(): void {
  hrefs = []
  loaded = false
}
