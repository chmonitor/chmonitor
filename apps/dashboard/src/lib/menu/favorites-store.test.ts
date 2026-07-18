import {
  __resetFavoritesForTests,
  getFavoriteHrefs,
  isFavoriteHref,
  pinFavorite,
  subscribeFavorites,
  toggleFavorite,
  unpinFavorite,
} from './favorites-store'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// In-memory localStorage shim — mirrors recent-items.test.ts / dismissed-insights.test.ts
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

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  ;(globalThis as { window?: unknown }).window = globalThis
  __resetFavoritesForTests()
})

afterEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = undefined
  ;(globalThis as { window?: unknown }).window = undefined
})

describe('SSR guard (window === undefined)', () => {
  test('getFavoriteHrefs returns empty array when window is undefined', () => {
    pinFavorite('/overview')
    ;(globalThis as { window?: unknown }).window = undefined
    __resetFavoritesForTests()
    expect(getFavoriteHrefs()).toEqual([])
  })

  test('pinFavorite is a no-op (in-memory only) when window is undefined', () => {
    ;(globalThis as { window?: unknown }).window = undefined
    pinFavorite('/overview')
    expect(getFavoriteHrefs()).toEqual(['/overview'])
  })
})

describe('pinFavorite / unpinFavorite / isFavoriteHref', () => {
  test('pins an href and reports it as favorited', () => {
    pinFavorite('/overview')
    expect(isFavoriteHref('/overview')).toBe(true)
    expect(getFavoriteHrefs()).toEqual(['/overview'])
  })

  test('pinning the same href twice does not duplicate it', () => {
    pinFavorite('/overview')
    pinFavorite('/overview')
    expect(getFavoriteHrefs()).toEqual(['/overview'])
  })

  test('preserves pin order across multiple pins', () => {
    pinFavorite('/overview')
    pinFavorite('/traffic')
    pinFavorite('/merges')
    expect(getFavoriteHrefs()).toEqual(['/overview', '/traffic', '/merges'])
  })

  test('unpinFavorite removes only the given href, keeping order', () => {
    pinFavorite('/overview')
    pinFavorite('/traffic')
    pinFavorite('/merges')
    unpinFavorite('/traffic')
    expect(getFavoriteHrefs()).toEqual(['/overview', '/merges'])
    expect(isFavoriteHref('/traffic')).toBe(false)
  })

  test('unpinning a non-pinned href is a no-op', () => {
    pinFavorite('/overview')
    unpinFavorite('/not-pinned')
    expect(getFavoriteHrefs()).toEqual(['/overview'])
  })
})

describe('toggleFavorite', () => {
  test('pins when not favorited, unpins when favorited', () => {
    toggleFavorite('/overview')
    expect(isFavoriteHref('/overview')).toBe(true)
    toggleFavorite('/overview')
    expect(isFavoriteHref('/overview')).toBe(false)
  })
})

describe('persistence round-trip', () => {
  test('reload picks up hrefs persisted by a prior "session"', () => {
    pinFavorite('/overview')
    pinFavorite('/traffic')
    __resetFavoritesForTests()
    expect(getFavoriteHrefs()).toEqual(['/overview', '/traffic'])
  })

  test('tolerates malformed JSON in localStorage', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem('chm-pinned-favorites', 'not-valid-json')
    expect(getFavoriteHrefs()).toEqual([])
  })

  test('tolerates a non-array JSON value in localStorage', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem(
      'chm-pinned-favorites',
      JSON.stringify({ not: 'an array' })
    )
    expect(getFavoriteHrefs()).toEqual([])
  })

  test('drops non-string entries from a malformed stored array', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem(
      'chm-pinned-favorites',
      JSON.stringify(['/overview', 42, null, '/traffic'])
    )
    expect(getFavoriteHrefs()).toEqual(['/overview', '/traffic'])
  })

  test('still works normally after corrupt data was present', () => {
    ;(
      globalThis as unknown as { localStorage: MemoryStorage }
    ).localStorage.setItem('chm-pinned-favorites', 'CORRUPT')
    pinFavorite('/recovery')
    expect(getFavoriteHrefs()).toEqual(['/recovery'])
  })
})

describe('subscribeFavorites', () => {
  test('notifies listeners on pin and unpin', () => {
    let calls = 0
    const unsubscribe = subscribeFavorites(() => {
      calls += 1
    })
    pinFavorite('/overview')
    unpinFavorite('/overview')
    unsubscribe()
    expect(calls).toBe(2)
  })

  test('does not notify after unsubscribing', () => {
    let calls = 0
    const unsubscribe = subscribeFavorites(() => {
      calls += 1
    })
    unsubscribe()
    pinFavorite('/overview')
    expect(calls).toBe(0)
  })

  test('pinning an already-pinned href does not notify (no state change)', () => {
    pinFavorite('/overview')
    let calls = 0
    const unsubscribe = subscribeFavorites(() => {
      calls += 1
    })
    pinFavorite('/overview')
    unsubscribe()
    expect(calls).toBe(0)
  })
})
