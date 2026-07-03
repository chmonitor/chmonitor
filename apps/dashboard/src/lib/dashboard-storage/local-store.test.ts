import type { DashboardLayout } from '@/types/dashboard-layout'

import {
  deleteDashboardLocal,
  listDashboardsLocal,
  loadDashboardLocal,
  saveDashboardLocal,
} from './local-store'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const STORAGE_KEY = 'clickhouse-monitor-dashboards'

const layoutA: DashboardLayout = {
  widgets: [
    {
      id: 'w1',
      type: 'chart',
      chartName: 'chart1',
      x: 0,
      y: 0,
      w: 6,
      h: 4,
    },
    {
      id: 'w2',
      type: 'chart',
      chartName: 'chart2',
      x: 6,
      y: 0,
      w: 6,
      h: 4,
    },
  ],
}

const emptyLayout: DashboardLayout = { widgets: [] }

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
      expect(() => saveDashboardLocal('x', layoutA)).not.toThrow()
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
      saveDashboardLocal('myDash', layoutA)
      expect(loadDashboardLocal('myDash')).toEqual(layoutA)
    })

    it('saves an empty layout', () => {
      saveDashboardLocal('empty', emptyLayout)
      expect(loadDashboardLocal('empty')).toEqual(emptyLayout)
    })

    it('overwrites an existing dashboard with the same name', () => {
      saveDashboardLocal('dash', layoutA)
      const layoutB: DashboardLayout = {
        widgets: [{ id: 'w3', type: 'text', x: 0, y: 0, w: 3, h: 2 }],
      }
      saveDashboardLocal('dash', layoutB)
      expect(loadDashboardLocal('dash')).toEqual(layoutB)
    })

    it('preserves other dashboards when saving a new one', () => {
      saveDashboardLocal('a', layoutA)
      saveDashboardLocal('b', emptyLayout)
      expect(loadDashboardLocal('a')).toEqual(layoutA)
      expect(loadDashboardLocal('b')).toEqual(emptyLayout)
    })
  })

  describe('loadDashboardLocal', () => {
    it('returns null for a non-existent dashboard', () => {
      expect(loadDashboardLocal('nonexistent')).toBeNull()
    })
  })

  describe('loadDashboardLocal — legacy back-compat', () => {
    it('upgrades a pre-plan-57 bare string[] value into a DashboardLayout', () => {
      // Simulate a dashboard saved before plan 57: the localStorage store
      // maps name -> string[] directly (no `saveDashboardLocal` involved).
      lsMock.setItem(
        STORAGE_KEY,
        JSON.stringify({ legacyDash: ['chart1', 'chart2'] })
      )

      const result = loadDashboardLocal('legacyDash')
      expect(result).not.toBeNull()
      expect(result?.widgets).toHaveLength(2)
      expect(result?.widgets.every((w) => w.type === 'chart')).toBe(true)
      expect(result?.widgets.map((w) => w.chartName)).toEqual([
        'chart1',
        'chart2',
      ])
    })

    it('a legacy dashboard survives a save/load round trip after being upgraded', () => {
      lsMock.setItem(STORAGE_KEY, JSON.stringify({ legacyDash: ['chart1'] }))
      const upgraded = loadDashboardLocal('legacyDash')
      expect(upgraded).not.toBeNull()

      // Re-saving persists the upgraded (non-legacy) shape.
      saveDashboardLocal('legacyDash', upgraded as DashboardLayout)
      expect(loadDashboardLocal('legacyDash')).toEqual(upgraded)
    })
  })

  describe('listDashboardsLocal', () => {
    it('returns empty array when no dashboards saved', () => {
      expect(listDashboardsLocal()).toEqual([])
    })

    it('returns sorted dashboard names', () => {
      saveDashboardLocal('zebra', emptyLayout)
      saveDashboardLocal('alpha', emptyLayout)
      saveDashboardLocal('middle', emptyLayout)
      expect(listDashboardsLocal()).toEqual(['alpha', 'middle', 'zebra'])
    })

    it('reflects names after deletion', () => {
      saveDashboardLocal('a', emptyLayout)
      saveDashboardLocal('b', emptyLayout)
      deleteDashboardLocal('a')
      expect(listDashboardsLocal()).toEqual(['b'])
    })
  })

  describe('deleteDashboardLocal', () => {
    it('removes a dashboard by name', () => {
      saveDashboardLocal('toDelete', layoutA)
      deleteDashboardLocal('toDelete')
      expect(loadDashboardLocal('toDelete')).toBeNull()
    })

    it('is a no-op for a non-existent dashboard', () => {
      saveDashboardLocal('keep', layoutA)
      expect(() => deleteDashboardLocal('ghost')).not.toThrow()
      // kept dashboard unaffected
      expect(loadDashboardLocal('keep')).toEqual(layoutA)
    })

    it('does not remove other dashboards', () => {
      saveDashboardLocal('a', layoutA)
      saveDashboardLocal('b', emptyLayout)
      deleteDashboardLocal('a')
      expect(loadDashboardLocal('b')).toEqual(emptyLayout)
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
      saveDashboardLocal('fresh', layoutA)
      expect(loadDashboardLocal('fresh')).toEqual(layoutA)
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
