/**
 * Sidebar subgroup open state (#3676) — browser-local only.
 *
 * `{ "<group>/<subgroup>": boolean }` under one localStorage key. Missing
 * storage (private mode, disabled, quota) falls back to the active-page rule:
 * every read returns `{}` and every write is a no-op. Entries for subgroups
 * that no longer exist are dropped on the next write. Same guard style as
 * `lib/menu/favorites-store.ts`.
 */

import { menuItemsConfig } from '@/menu'

import { subgroupKey } from './subgroups'

export const SUBGROUP_OPEN_STORAGE_KEY = 'chm-menu-subgroups-open'

export type SubgroupOpenState = Record<string, boolean>

function knownKeys(): Set<string> {
  const keys = new Set<string>()
  for (const group of menuItemsConfig) {
    for (const child of group.items ?? []) {
      if (child.subgroup) keys.add(subgroupKey(group.title, child.subgroup))
    }
  }
  return keys
}

export function readSubgroupOpenState(): SubgroupOpenState {
  if (typeof window === 'undefined') return {}
  try {
    const stored = localStorage.getItem(SUBGROUP_OPEN_STORAGE_KEY)
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const state: SubgroupOpenState = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') state[key] = value
    }
    return state
  } catch {
    return {}
  }
}

export function writeSubgroupOpen(key: string, open: boolean): void {
  if (typeof window === 'undefined') return
  try {
    const known = knownKeys()
    const next: SubgroupOpenState = {}
    for (const [k, v] of Object.entries(readSubgroupOpenState())) {
      if (known.has(k)) next[k] = v
    }
    next[key] = open
    localStorage.setItem(SUBGROUP_OPEN_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or disabled: the active-page rule still applies.
  }
}
