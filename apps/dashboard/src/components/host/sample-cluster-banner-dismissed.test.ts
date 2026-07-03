/**
 * Tests for sample-cluster-banner-dismissed.ts
 *
 * Mocks localStorage via globalThis to cover the SSR guard, the dismiss flag
 * round-trip, and a disabled/throwing localStorage.
 */

import {
  dismissSampleClusterBanner,
  isSampleClusterBannerDismissed,
} from './sample-cluster-banner-dismissed'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

function makeLocalStorageStub() {
  const store: Record<string, string> = {}
  return {
    store,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
  }
}

type LocalStorageStub = ReturnType<typeof makeLocalStorageStub>

let lsStub: LocalStorageStub

beforeEach(() => {
  lsStub = makeLocalStorageStub()
  Object.defineProperty(globalThis, 'localStorage', {
    value: lsStub,
    writable: true,
    configurable: true,
  })
  if (typeof globalThis.window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      writable: true,
      configurable: true,
    })
  }
})

afterEach(() => {
  try {
    delete (globalThis as Record<string, unknown>).localStorage
  } catch {
    // ignore
  }
})

describe('isSampleClusterBannerDismissed', () => {
  test('false when never dismissed', () => {
    expect(isSampleClusterBannerDismissed()).toBe(false)
  })

  test('true after dismissSampleClusterBanner()', () => {
    dismissSampleClusterBanner()
    expect(isSampleClusterBannerDismissed()).toBe(true)
  })

  test('false when localStorage throws on read', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('disabled')
        },
      },
      writable: true,
      configurable: true,
    })
    expect(isSampleClusterBannerDismissed()).toBe(false)
  })
})

describe('dismissSampleClusterBanner', () => {
  test('silently fails when localStorage.setItem throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded')
        },
      },
      writable: true,
      configurable: true,
    })
    expect(() => dismissSampleClusterBanner()).not.toThrow()
  })
})
