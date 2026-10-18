/**
 * Entries are pathnames only (no `?host=`): the host is re-applied by
 * `HostPrefixedLink` at render time, so one visit history serves every host.
 * Resolution against the live menu tree happens in {@link recentInGroup}, so
 * a renamed or removed route drops out instead of rendering a broken link.
 */

import type { MenuItem } from '@/components/menu/types'

const STORAGE_KEY = 'chm-recent-pages'

/** Enough history to fill every group's flyout without growing unbounded. */
export const RECENT_PAGES_CAP = 50

export const RECENT_PER_GROUP = 5

export const FALLBACK_PER_GROUP = 3

export interface RecentPage {
  path: string
  at: number
}

export function normalizePath(href: string): string {
  const path = href.split(/[?#]/)[0] ?? ''
  return path.replace(/\/+$/, '') || '/'
}

/**
 * Pure: move `path` to the front with timestamp `at`, drop older duplicates,
 * cap the list. Returns the same array when `path` is already the newest entry
 * so a re-render on the same page never churns the store.
 */
export function recordVisitIn(
  entries: readonly RecentPage[],
  path: string,
  at: number,
  cap = RECENT_PAGES_CAP
): readonly RecentPage[] {
  const normalized = normalizePath(path)
  if (entries[0]?.path === normalized) return entries
  const rest = entries.filter((entry) => entry.path !== normalized)
  return [{ path: normalized, at }, ...rest].slice(0, cap)
}

/**
 * Pure: the group's children the user visited, newest first, at most `limit`.
 * A menu href may carry a query (`/keeper?path=/`); matching is by path, and
 * when two children share a path only the first one is used.
 */
export function recentInGroup(
  entries: readonly RecentPage[],
  children: readonly MenuItem[],
  limit = RECENT_PER_GROUP
): MenuItem[] {
  const byPath = new Map<string, MenuItem>()
  for (const child of children) {
    if (!child.href) continue
    const key = normalizePath(child.href)
    if (!byPath.has(key)) byPath.set(key, child)
  }
  const result: MenuItem[] = []
  for (const entry of entries) {
    const item = byPath.get(entry.path)
    if (item && !result.includes(item)) result.push(item)
    if (result.length >= limit) break
  }
  return result
}

export interface GroupQuickLinks {
  pinned: MenuItem[]
  recent: MenuItem[]
  fallback: MenuItem[]
}

/**
 * Pure: the flyout sections for one group. Pinned first (in pin order), then
 * recent with anything already pinned removed, so a page is never listed
 * twice. With both empty, the group's first pages stand in.
 */
export function buildGroupQuickLinks(
  children: readonly MenuItem[],
  favoriteHrefs: readonly string[],
  entries: readonly RecentPage[],
  limits: { recent?: number; fallback?: number } = {}
): GroupQuickLinks {
  const byHref = new Map(
    children.filter((c) => c.href).map((c) => [c.href, c] as const)
  )
  const pinned = favoriteHrefs
    .map((href) => byHref.get(href))
    .filter((item): item is MenuItem => item !== undefined)
  const pinnedSet = new Set(pinned)
  const recent = recentInGroup(
    entries,
    children.filter((c) => !pinnedSet.has(c)),
    limits.recent ?? RECENT_PER_GROUP
  )
  const fallback =
    pinned.length === 0 && recent.length === 0
      ? children
          .filter((c) => c.href)
          .slice(0, limits.fallback ?? FALLBACK_PER_GROUP)
      : []
  return { pinned, recent, fallback }
}

let entries: readonly RecentPage[] = []
let loaded = false
const listeners = new Set<() => void>()

function load(): RecentPage[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '[]'
    )
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is RecentPage =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as RecentPage).path === 'string' &&
        typeof (v as RecentPage).at === 'number'
    )
  } catch {
    return []
  }
}

function ensureLoaded(): void {
  if (loaded) return
  entries = load()
  loaded = true
}

export function recordRecentPage(path: string, at = Date.now()): void {
  ensureLoaded()
  const next = recordVisitIn(entries, path, at)
  if (next === entries) return
  entries = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or disabled: history stays in memory for this tab.
  }
  for (const listener of listeners) listener()
}

export function subscribeRecentPages(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getRecentPagesSnapshot(): readonly RecentPage[] {
  ensureLoaded()
  return entries
}

const EMPTY: readonly RecentPage[] = []

export function getRecentPagesServerSnapshot(): readonly RecentPage[] {
  return EMPTY
}

export function __resetRecentPagesForTests(): void {
  entries = []
  loaded = false
}
