/**
 * Recently-selected command palette items, persisted in localStorage.
 *
 * Kept free of React imports so it can be unit-tested in isolation and reused
 * by any palette surface (mirrors lib/insights/dismissed-insights.ts).
 */

const STORAGE_KEY = 'command-palette-recent-items'
const MAX_RECENT = 5

/** Generic kind used to pick an icon at render time (no JSX stored). */
export type RecentPaletteItemKind = 'page' | 'database' | 'table' | 'action'

export interface RecentPaletteItem {
  /** Stable identity for de-duping (e.g. the href, or `db-<name>`). */
  id: string
  title: string
  description?: string
  href: string
  kind: RecentPaletteItemKind
}

export function getRecentItems(): RecentPaletteItem[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? (parsed as RecentPaletteItem[]) : []
  } catch {
    return []
  }
}

export function addRecentItem(item: RecentPaletteItem): void {
  if (typeof window === 'undefined') return
  try {
    const existing = getRecentItems().filter((i) => i.id !== item.id)
    const next = [item, ...existing].slice(0, MAX_RECENT)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Silently fail if localStorage is full or disabled.
  }
}

export function clearRecentItems(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Silently fail.
  }
}
