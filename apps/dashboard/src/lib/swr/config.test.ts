import { REFRESH_INTERVAL, visibilityAwareInterval } from './config'
import { afterEach, describe, expect, it } from 'bun:test'

// `document` is not defined in the bun test runtime by default; each test that
// needs it sets a minimal stub and restores afterwards.
const originalDocument = (globalThis as { document?: unknown }).document

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document
  } else {
    ;(globalThis as { document?: unknown }).document = originalDocument
  }
})

describe('visibilityAwareInterval', () => {
  it('returns a function, not a raw number, so hidden tabs can pause polling', () => {
    expect(typeof visibilityAwareInterval(REFRESH_INTERVAL.MEDIUM_30S)).toBe(
      'function'
    )
  })

  it('resolves to the interval ms when the tab is visible', () => {
    ;(globalThis as { document?: unknown }).document = { hidden: false }
    const resolve = visibilityAwareInterval(REFRESH_INTERVAL.SLOW_2M)
    expect(resolve()).toBe(REFRESH_INTERVAL.SLOW_2M)
  })

  it('resolves to false (paused) when the tab is hidden', () => {
    ;(globalThis as { document?: unknown }).document = { hidden: true }
    const resolve = visibilityAwareInterval(REFRESH_INTERVAL.MEDIUM_30S)
    expect(resolve()).toBe(false)
  })

  it('resolves to the interval ms when document is unavailable (SSR)', () => {
    delete (globalThis as { document?: unknown }).document
    const resolve = visibilityAwareInterval(60_000)
    expect(resolve()).toBe(60_000)
  })
})
