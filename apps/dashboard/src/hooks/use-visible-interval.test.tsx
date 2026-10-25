/**
 * useVisibleInterval: the interval stops while the tab is hidden and the
 * callback runs once immediately when the tab becomes visible again.
 *
 * happy-dom + react-dom/client. setInterval is replaced with a manual fake so
 * the test controls exactly when ticks fire.
 */

import { useVisibleInterval } from './use-visible-interval'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

type FakeTimer = { id: number; ms: number; elapsed: number; fn: () => void }

let timers: FakeTimer[] = []
let nextId = 1
let visibility: DocumentVisibilityState = 'visible'

const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval

function fakeSetInterval(fn: () => void, ms: number) {
  const id = nextId++
  timers.push({ id, ms, elapsed: 0, fn })
  return id as unknown as ReturnType<typeof setInterval>
}

function fakeClearInterval(id: unknown) {
  timers = timers.filter((t) => t.id !== id)
}

function advance(ms: number) {
  act(() => {
    for (let i = 0; i < ms; i++) {
      for (const t of [...timers]) {
        t.elapsed++
        if (t.elapsed >= t.ms) {
          t.elapsed = 0
          t.fn()
        }
      }
    }
  })
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeAll(() => {
  GlobalRegistrator.register()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  GlobalRegistrator.unregister()
})

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  timers = []
  nextId = 1
  visibility = 'visible'
  globalThis.setInterval = fakeSetInterval as typeof setInterval
  globalThis.clearInterval = fakeClearInterval as typeof clearInterval
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
})

function Probe({ onTick, ms }: { onTick: () => void; ms: number }) {
  useVisibleInterval(onTick, ms)
  return null
}

function mount(onTick: () => void, ms: number) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(createElement(Probe, { onTick, ms })))
}

describe('useVisibleInterval', () => {
  test('ticks at the configured interval while the tab is visible', () => {
    let ticks = 0
    mount(() => ticks++, 1000)

    advance(3000)

    expect(ticks).toBe(3)
  })

  test('stops ticking while the tab is hidden and resumes on visible', () => {
    let ticks = 0
    mount(() => ticks++, 1000)

    advance(2000)
    expect(ticks).toBe(2)

    act(() => setVisibility('hidden'))
    advance(5000)
    expect(ticks).toBe(2)
    expect(timers.length).toBe(0)
  })

  test('runs the callback once immediately when the tab becomes visible', () => {
    let ticks = 0
    mount(() => ticks++, 1000)

    act(() => setVisibility('hidden'))
    advance(5000)
    expect(ticks).toBe(0)

    act(() => setVisibility('visible'))
    expect(ticks).toBe(1)

    advance(1000)
    expect(ticks).toBe(2)
  })

  test('does not start an interval when mounted while hidden', () => {
    visibility = 'hidden'
    let ticks = 0
    mount(() => ticks++, 1000)

    advance(3000)
    expect(ticks).toBe(0)
    expect(timers.length).toBe(0)
  })

  test('removes the listener and timer on unmount', () => {
    let ticks = 0
    mount(() => ticks++, 1000)

    act(() => root?.unmount())
    root = null

    expect(timers.length).toBe(0)
    act(() => setVisibility('visible'))
    expect(ticks).toBe(0)
  })
})
