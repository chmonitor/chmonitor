import { runWhenIdle } from './run-when-idle'
import { afterEach, describe, expect, test } from 'bun:test'

const g = globalThis as Record<string, unknown>
const savedRic = g.requestIdleCallback

afterEach(() => {
  g.requestIdleCallback = savedRic
})

describe('runWhenIdle', () => {
  test('uses requestIdleCallback with a deadline so the task cannot starve', () => {
    let seen: { timeout?: number } | undefined
    let cb: (() => void) | undefined
    g.requestIdleCallback = (fn: () => void, opts: { timeout?: number }) => {
      cb = fn
      seen = opts
      return 1
    }
    let ran = false
    runWhenIdle(() => {
      ran = true
    }, 1234)
    expect(ran).toBe(false)
    expect(seen?.timeout).toBe(1234)
    cb?.()
    expect(ran).toBe(true)
  })

  test('falls back to a timer when requestIdleCallback is missing', async () => {
    delete g.requestIdleCallback
    let ran = false
    runWhenIdle(() => {
      ran = true
    }, 5)
    expect(ran).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(ran).toBe(true)
  })
})
