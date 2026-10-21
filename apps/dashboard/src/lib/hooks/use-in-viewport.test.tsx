/**
 * `useInViewport` + `pausableInterval` pause polling for off-screen cards.
 * Harness: happy-dom + react-dom/client + act (same as
 * `lib/health/__tests__/use-notification-permission.test.tsx`).
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const saved: { fetch?: typeof globalThis.fetch; actEnv?: boolean } = {}

beforeAll(() => {
  saved.fetch = globalThis.fetch
  saved.actEnv = (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
  if (saved.fetch) globalThis.fetch = saved.fetch
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = saved.actEnv
})

type IOCallback = (entries: { isIntersecting: boolean }[]) => void

const instances: FakeObserver[] = []

class FakeObserver {
  observed: Element[] = []
  disconnected = false
  constructor(
    readonly callback: IOCallback,
    readonly options?: { rootMargin?: string }
  ) {
    instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  disconnect() {
    this.disconnected = true
  }
}

const g = globalThis as { IntersectionObserver?: unknown }
const originalIO = g.IntersectionObserver

afterEach(() => {
  instances.length = 0
  g.IntersectionObserver = originalIO
})

async function mount(rootMargin?: string) {
  const { createElement, useRef } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const { useInViewport } = await import('./use-in-viewport')

  const seen: boolean[] = []
  function Probe() {
    const ref = useRef<HTMLDivElement>(null)
    seen.push(useInViewport(ref, rootMargin))
    return createElement('div', { ref })
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(Probe))
  })
  return { seen, act, root }
}

describe('useInViewport', () => {
  test('reports the observer state with a lookahead rootMargin', async () => {
    g.IntersectionObserver = FakeObserver
    const { seen, act, root } = await mount()
    const io = instances[0]
    expect(io.options?.rootMargin).toBe('200px 0px')
    expect(io.observed).toHaveLength(1)
    expect(seen.at(-1)).toBe(true)

    await act(async () => io.callback([{ isIntersecting: false }]))
    expect(seen.at(-1)).toBe(false)

    await act(async () => io.callback([{ isIntersecting: true }]))
    expect(seen.at(-1)).toBe(true)

    await act(async () => root.unmount())
    expect(io.disconnected).toBe(true)
  })

  test('fails open to true when IntersectionObserver is unsupported', async () => {
    g.IntersectionObserver = undefined
    const { seen } = await mount()
    expect(instances).toHaveLength(0)
    expect(seen.every((v) => v === true)).toBe(true)
  })
})

describe('pausableInterval', () => {
  const doc = globalThis as { document?: unknown }
  const originalDoc = doc.document
  afterEach(() => {
    doc.document = originalDoc
  })

  test('resolves to the normal interval while in view', async () => {
    const { pausableInterval } = await import('./use-in-viewport')
    doc.document = { hidden: false }
    expect(pausableInterval(30_000, true)()).toBe(30_000)
  })

  test('resolves to false while off-screen (polling paused)', async () => {
    const { pausableInterval } = await import('./use-in-viewport')
    doc.document = { hidden: false }
    expect(pausableInterval(30_000, false)()).toBe(false)
  })

  test('still pauses for a hidden tab even when in view', async () => {
    const { pausableInterval } = await import('./use-in-viewport')
    doc.document = { hidden: true }
    expect(pausableInterval(30_000, true)()).toBe(false)
  })
})
