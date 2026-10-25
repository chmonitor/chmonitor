/**
 * "updated Ns ago" must count real elapsed time, including time spent while the
 * tab was hidden, and reset when fresh topology data arrives.
 *
 * happy-dom + react-dom/client. setInterval is faked and the clock is driven by
 * bun's setSystemTime so Date.now() moves with the fake timers.
 */

import { TopologyUpdatedAgo } from './topology-updated-ago'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

type FakeTimer = { id: number; ms: number; elapsed: number; fn: () => void }

let timers: FakeTimer[] = []
let nextId = 1
let visibility: DocumentVisibilityState = 'visible'
let clockMs = 0

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

/** Moves the clock and fires fake interval ticks, one millisecond at a time. */
function advance(ms: number) {
  act(() => {
    for (let i = 0; i < ms; i++) {
      clockMs += 1
      setSystemTime(new Date(clockMs))
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
  clockMs = 1_700_000_000_000
  setSystemTime(new Date(clockMs))
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
  setSystemTime()
})

function render(topology: unknown, liveRow: unknown) {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() =>
    root?.render(createElement(TopologyUpdatedAgo, { topology, liveRow }))
  )
  return container.textContent
}

describe('TopologyUpdatedAgo', () => {
  test('counts seconds since the data last changed', () => {
    const topo = { id: 1 }
    expect(render(topo, null)).toBe('0s')

    advance(3000)
    expect(container?.textContent).toBe('3s')
  })

  test('counts hidden time once the tab is visible again', () => {
    const topo = { id: 1 }
    render(topo, null)
    advance(2000)
    expect(container?.textContent).toBe('2s')

    act(() => setVisibility('hidden'))
    advance(5000)
    expect(container?.textContent).toBe('2s')

    act(() => setVisibility('visible'))
    expect(container?.textContent).toBe('7s')

    advance(1000)
    expect(container?.textContent).toBe('8s')
  })

  test('resets to 0s when fresh topology data arrives', () => {
    const topo = { id: 1 }
    render(topo, null)
    advance(4000)
    expect(container?.textContent).toBe('4s')

    render({ id: 2 }, null)
    expect(container?.textContent).toBe('0s')
  })
})
