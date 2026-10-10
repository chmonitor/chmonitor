/**
 * Page-wide, persisted selection for <ConfigTabs>. Every ConfigTabs with the
 * same `groupId` shares one value: picking "Helm" in one block switches every
 * block on the page, and the choice is remembered across visits.
 *
 * Storage access is wrapped in try/catch: private windows and blocked site
 * data throw on `localStorage`, and the tabs must still work without it.
 */
type Listener = () => void

export const STORAGE_PREFIX = 'chm-docs:config-tab:'

const values = new Map<string, string>()
const listeners = new Map<string, Set<Listener>>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readStored(groupId: string): string | null {
  try {
    return storage()?.getItem(STORAGE_PREFIX + groupId) ?? null
  } catch {
    return null
  }
}

export function getSelection(groupId: string): string | null {
  if (!values.has(groupId)) {
    const stored = readStored(groupId)
    if (stored !== null) values.set(groupId, stored)
  }
  return values.get(groupId) ?? null
}

export function setSelection(groupId: string, value: string): void {
  values.set(groupId, value)
  try {
    storage()?.setItem(STORAGE_PREFIX + groupId, value)
  } catch {
    // Quota or blocked storage: the in-memory value still syncs this page.
  }
  for (const l of listeners.get(groupId) ?? []) l()
}

export function subscribe(groupId: string, listener: Listener): () => void {
  let set = listeners.get(groupId)
  if (!set) {
    set = new Set()
    listeners.set(groupId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

/** A stored value only applies when this block actually has that tab. */
export function resolveSelection(
  selected: string | null,
  items: readonly string[],
  fallback: string
): string {
  return selected !== null && items.includes(selected) ? selected : fallback
}

/** Test-only: forget in-memory state between cases. */
export function resetConfigTabsStore(): void {
  values.clear()
  listeners.clear()
}
