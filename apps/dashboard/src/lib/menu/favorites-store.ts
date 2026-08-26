/**
 * Pinned favorite menu items — browser-local only (issue #2769).
 *
 * Persists hrefs in pin order to localStorage. Device-level, no server/DB
 * storage: works signed-out and in OSS mode. Stale hrefs (a pinned route that
 * got renamed or removed) are tolerated by the reader
 * (`lib/menu/derive-favorites.ts`), not here — this module only persists the
 * raw href list.
 *
 * Same external-store shape as other module-level snapshot stores: a module-level
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

/**
 * Move `fromHref` to the current index of `toHref`. Returns a new array.
 * Unknown or identical hrefs are a no-op (copy of the input).
 */
export function moveHref(
  hrefs: readonly string[],
  fromHref: string,
  toHref: string
): string[] {
  if (fromHref === toHref) return hrefs.slice()
  const fromIndex = hrefs.indexOf(fromHref)
  const toIndex = hrefs.indexOf(toHref)
  if (fromIndex === -1 || toIndex === -1) return hrefs.slice()
  const next = hrefs.slice()
  next.splice(fromIndex, 1)
  next.splice(toIndex, 0, fromHref)
  return next
}

/** Pinned hrefs in pin order (user-reorderable; new pins append). */
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

/** Move a pinned href to another pinned href's index. No-op if either is missing. */
export function reorderFavorites(fromHref: string, toHref: string): void {
  ensureLoaded()
  if (fromHref === toHref) return
  const next = moveHref(hrefs, fromHref, toHref)
  if (
    next.length === hrefs.length &&
    next.every((href, i) => href === hrefs[i])
  ) {
    return
  }
  hrefs = next
  persist()
  emit()
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
