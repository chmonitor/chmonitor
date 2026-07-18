import type { RecentPaletteItem } from './recent-items'

import { addRecentItem, clearRecentItems, getRecentItems } from './recent-items'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// In-memory localStorage shim (bun has no DOM) — mirrors dismissed-insights.test.ts
// ---------------------------------------------------------------------------

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null
  }

  setItem(k: string, v: string): void {
    this.store.set(k, String(v))
  }

  removeItem(k: string): void {
    this.store.delete(k)
  }

  clear(): void {
    this.store.clear()
  }
}

function makeItem(id: string, overrides: Partial<RecentPaletteItem> = {}) {
  return {
    id,
    title: id,
    href: `/${id}`,
    kind: 'page' as const,
    ...overrides,
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = globalThis
})

afterEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = undefined
  ;(globalThis as { window?: unknown }).window = undefined
})

describe('SSR guard (window === undefined)', () => {
  test('getRecentItems returns empty array when window is undefined', () => {
    addRecentItem(makeItem('ssr'))
    ;(globalThis as { window?: unknown }).window = undefined
    expect(getRecentItems()).toEqual([])
  })

  test('addRecentItem is a no-op when window is undefined', () => {
    ;(globalThis as { window?: unknown }).window = undefined
    addRecentItem(makeItem('noop'))
    ;(globalThis as { window?: unknown }).window = globalThis
    expect(getRecentItems()).toEqual([])
  })

  test('clearRecentItems is a no-op when window is undefined', () => {
    addRecentItem(makeItem('pre-stored'))
    ;(globalThis as { window?: unknown }).window = undefined
    clearRecentItems()
    ;(globalThis as { window?: unknown }).window = globalThis
    expect(getRecentItems()).toHaveLength(1)
  })
})

describe('getRecentItems', () => {
  test('returns an empty array when localStorage is empty', () => {
    expect(getRecentItems()).toEqual([])
  })

  test('returns items in most-recently-added-first order', () => {
    addRecentItem(makeItem('a'))
    addRecentItem(makeItem('b'))
    expect(getRecentItems().map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('addRecentItem', () => {
  test('de-duplicates by id, moving the item to the front', () => {
    addRecentItem(makeItem('a'))
    addRecentItem(makeItem('b'))
    addRecentItem(makeItem('a'))
    const items = getRecentItems()
    expect(items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(items).toHaveLength(2)
  })

  test('caps the stored list at 5 items', () => {
    for (let i = 0; i < 8; i++) addRecentItem(makeItem(`item-${i}`))
    const items = getRecentItems()
    expect(items).toHaveLength(5)
    // Most recent 5 (item-7 .. item-3), newest first.
    expect(items.map((i) => i.id)).toEqual([
      'item-7',
      'item-6',
      'item-5',
      'item-4',
      'item-3',
    ])
  })

  test('persists title, description, href, and kind', () => {
    addRecentItem(
      makeItem('t', {
        title: 'Traffic',
        description: 'Data flowing into the cluster',
        href: '/traffic?host=0',
        kind: 'page',
      })
    )
    expect(getRecentItems()[0]).toEqual({
      id: 't',
      title: 'Traffic',
      description: 'Data flowing into the cluster',
      href: '/traffic?host=0',
      kind: 'page',
    })
  })
})

describe('clearRecentItems', () => {
  test('removes all stored items', () => {
    addRecentItem(makeItem('a'))
    addRecentItem(makeItem('b'))
    clearRecentItems()
    expect(getRecentItems()).toEqual([])
  })

  test('is safe to call on an already-empty store', () => {
    clearRecentItems()
    expect(getRecentItems()).toEqual([])
  })
})

describe('malformed JSON in localStorage', () => {
  test('getRecentItems returns empty array for non-JSON value', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem('command-palette-recent-items', 'not-valid-json')
    expect(getRecentItems()).toEqual([])
  })

  test('getRecentItems returns empty array for a JSON object (non-array)', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem(
      'command-palette-recent-items',
      JSON.stringify({ not: 'an array' })
    )
    expect(getRecentItems()).toEqual([])
  })

  test('addRecentItem still works after corrupt data was present', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem('command-palette-recent-items', 'CORRUPT')
    addRecentItem(makeItem('recovery'))
    expect(getRecentItems().map((i) => i.id)).toEqual(['recovery'])
  })
})
