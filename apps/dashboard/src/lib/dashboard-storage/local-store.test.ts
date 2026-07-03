import {
  deleteDashboardLocal,
  listDashboardsLocal,
  loadDashboardLocal,
  saveDashboardLocal,
} from './local-store'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const STORAGE_KEY = 'clickhouse-monitor-dashboards'

// Minimal localStorage mock
function makeLocalStorageMock() {
  const store: Record<string, string> = {}
  return {
    getItem(key: string): string | null {
      return Object.hasOwn(store, key) ? store[key] : null
    },
    setItem(key: string, value: string): void {
      store[key] = value
    },
    removeItem(key: string): void {
      delete store[key]
    },
    clear(): void {
      for (const k of Object.keys(store)) delete store[k]
    },
    get length() {
      return Object.keys(store).length
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null
    },
  }
}

describe('local-store — SSR guard', () => {
  it('returns empty list when window is undefined', () => {
    // Bun runs in Node; window is undefined by default
    const savedWindow = globalThis.window
    // @ts-expect-error
    delete globalThis.window
    // @ts-expect-error
    delete globalThis.localStorage

    try {
      expect(listDashboardsLocal()).toEqual([])
      expect(loadDashboardLocal('any')).toBeNull()
      // saveDashboardLocal and deleteDashboardLocal should be no-ops (no throw)
      expect(() => saveDashboardLocal('x', ['a'])).not.toThrow()
      expect(() => deleteDashboardLocal('x')).not.toThrow()
    } finally {
      globalThis.window = savedWindow
    }
  })
})

describe('local-store — with localStorage mock', () => {
  let lsMock: ReturnType<typeof makeLocalStorageMock>

  beforeEach(() => {
    lsMock = makeLocalStorageMock()
    // @ts-expect-error
    globalThis.window = globalThis
    globalThis.localStorage = lsMock
  })

  afterEach(() => {
    // @ts-expect-error
    delete globalThis.window
    // @ts-expect-error
    delete globalThis.localStorage
  })

  describe('saveDashboardLocal / loadDashboardLocal round-trip', () => {
    it('saves and loads a dashboard by name', () => {
      saveDashboardLocal('myDash', ['chart1', 'chart2'])
      expect(loadDashboardLocal('myDash')).toEqual(['chart1', 'chart2'])
    })

    it('saves an empty chart list', () => {
      saveDashboardLocal('empty', [])
      expect(loadDashboardLocal('empty')).toEqual([])
    })

    it('overwrites an existing dashboard with the same name', () => {
      saveDashboardLocal('dash', ['old'])
      saveDashboardLocal('dash', ['new1', 'new2'])
      expect(loadDashboardLocal('dash')).toEqual(['new1', 'new2'])
    })

    it('preserves other dashboards when saving a new one', () => {
      saveDashboardLocal('a', ['x'])
      saveDashboardLocal('b', ['y'])
      expect(loadDashboardLocal('a')).toEqual(['x'])
      expect(loadDashboardLocal('b')).toEqual(['y'])
    })
  })

  describe('loadDashboardLocal', () => {
    it('returns null for a non-existent dashboard', () => {
      expect(loadDashboardLocal('nonexistent')).toBeNull()
    })
  })

  describe('listDashboardsLocal', () => {
    it('returns empty array when no dashboards saved', () => {
      expect(listDashboardsLocal()).toEqual([])
    })

    it('returns sorted dashboard names', () => {
      saveDashboardLocal('zebra', [])
      saveDashboardLocal('alpha', [])
      saveDashboardLocal('middle', [])
      expect(listDashboardsLocal()).toEqual(['alpha', 'middle', 'zebra'])
    })

    it('reflects names after deletion', () => {
      saveDashboardLocal('a', [])
      saveDashboardLocal('b', [])
      deleteDashboardLocal('a')
      expect(listDashboardsLocal()).toEqual(['b'])
    })
  })

  describe('deleteDashboardLocal', () => {
    it('removes a dashboard by name', () => {
      saveDashboardLocal('toDelete', ['c1'])
      deleteDashboardLocal('toDelete')
      expect(loadDashboardLocal('toDelete')).toBeNull()
    })

    it('is a no-op for a non-existent dashboard', () => {
      saveDashboardLocal('keep', ['x'])
      expect(() => deleteDashboardLocal('ghost')).not.toThrow()
      // kept dashboard unaffected
      expect(loadDashboardLocal('keep')).toEqual(['x'])
    })

    it('does not remove other dashboards', () => {
      saveDashboardLocal('a', ['1'])
      saveDashboardLocal('b', ['2'])
      deleteDashboardLocal('a')
      expect(loadDashboardLocal('b')).toEqual(['2'])
    })
  })

  describe('malformed JSON fallback', () => {
    it('treats invalid JSON as an empty store', () => {
      lsMock.setItem(STORAGE_KEY, 'not-json{{{')
      expect(listDashboardsLocal()).toEqual([])
      expect(loadDashboardLocal('x')).toBeNull()
    })

    it('treats a JSON array as an empty store', () => {
      lsMock.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']))
      expect(listDashboardsLocal()).toEqual([])
    })

    it('treats null JSON value as an empty store', () => {
      lsMock.setItem(STORAGE_KEY, 'null')
      expect(listDashboardsLocal()).toEqual([])
    })

    it('treats a JSON primitive as an empty store', () => {
      lsMock.setItem(STORAGE_KEY, '42')
      expect(listDashboardsLocal()).toEqual([])
    })

    it('still allows saving after a malformed store', () => {
      lsMock.setItem(STORAGE_KEY, 'bad')
      saveDashboardLocal('fresh', ['chart'])
      expect(loadDashboardLocal('fresh')).toEqual(['chart'])
    })
  })

  describe('default / missing key', () => {
    it('returns empty list when localStorage key is absent', () => {
      expect(listDashboardsLocal()).toEqual([])
    })

    it('returns null load when localStorage key is absent', () => {
      expect(loadDashboardLocal('anything')).toBeNull()
    })
  })
})
