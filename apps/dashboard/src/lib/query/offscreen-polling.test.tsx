/**
 * Chart cells scrolled out of view stop auto-refreshing, and catch up when
 * they scroll back in. Real boundary + real useChartData against a counting
 * fetch mock and a fake IntersectionObserver (happy-dom + react-dom/client).
 */

import type { ReactNode } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const fetches: string[] = []

mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: async (url: string) => {
    fetches.push(url)
    return new Response(
      JSON.stringify({ data: [{ value: fetches.length }], metadata: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  },
}))

mock.module('@/lib/swr/use-merged-hosts', () => ({
  isServerHost: () => true,
  useMergedHosts: () => ({
    hosts: [{ id: 0, name: 'A', host: 'http://a', source: 'env' }],
    getConnectionByHostId: () => null,
  }),
}))

class FakeObserver {
  static all: FakeObserver[] = []
  constructor(
    readonly callback: (entries: { isIntersecting: boolean }[]) => void
  ) {
    FakeObserver.all.push(this)
  }
  observe() {}
  disconnect() {}
}

const g = globalThis as { IntersectionObserver?: unknown }
const originalIO = g.IntersectionObserver

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  g.IntersectionObserver = FakeObserver
})

afterAll(async () => {
  g.IntersectionObserver = originalIO
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  fetches.length = 0
  FakeObserver.all = []
  document.body.replaceChildren()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function mountCards(
  names: string[],
  opts: { refreshInterval: number; wrap: boolean; pollingActive?: boolean }
) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QueryClient, QueryClientProvider } = await import(
    '@tanstack/react-query'
  )
  const { useChartData } = await import('./use-chart-data')
  const { ChartViewportBoundary } = await import(
    '@/components/layout/query-page/chart-viewport-boundary'
  )
  function Card({ name }: { name: string }) {
    const { data } = useChartData<{ value: number }>({
      chartName: name,
      hostId: 0,
      refreshInterval: opts.refreshInterval,
      pollingActive: opts.pollingActive,
    })
    return <output>{data[0]?.value}</output>
  }
  const cell = (name: string): ReactNode =>
    opts.wrap ? (
      <ChartViewportBoundary key={name}>
        <Card name={name} />
      </ChartViewportBoundary>
    ) : (
      <div key={name}>
        <Card name={name} />
      </div>
    )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        {names.map(cell)}
      </QueryClientProvider>
    )
  })
  const wait = (ms: number) => sleep(ms)
  const setVisible = (visible: boolean) =>
    act(async () => {
      for (const io of FakeObserver.all) {
        io.callback([{ isIntersecting: visible }])
      }
    })
  const cleanup = () => act(async () => root.unmount())
  // react-query decides at module load whether it runs on a server and, if so,
  // never arms refetch intervals; other test files load it before happy-dom
  // registers. So assert on the interval each observer resolves to (what the
  // timer would be armed with) instead of waiting for real interval fetches.
  const intervals = () =>
    queryClient
      .getQueryCache()
      .getAll()
      .map((q) => {
        const o = q.observers[0]?.options.refetchInterval
        return typeof o === 'function' ? o(q) : o
      })
  return { wait, setVisible, cleanup, intervals }
}

describe('off-screen chart polling', () => {
  test('without a boundary the context default keeps polling', async () => {
    const m = await mountCards(['a'], { refreshInterval: 40, wrap: false })
    try {
      await m.wait(10)
      expect(m.intervals()).toEqual([40])
    } finally {
      await m.cleanup()
    }
  })

  test('an off-screen boundary pauses the refetch interval but keeps the first fetch', async () => {
    const m = await mountCards(['a'], { refreshInterval: 40, wrap: true })
    try {
      await m.wait(10)
      expect(m.intervals()).toEqual([40])
      await m.setVisible(false)
      await m.wait(10)
      expect(fetches).toHaveLength(1)
      expect(m.intervals()).toEqual([false])
      await m.setVisible(true)
      await m.wait(10)
      expect(m.intervals()).toEqual([40])
    } finally {
      await m.cleanup()
    }
  })

  test('an explicit pollingActive prop overrides the context', async () => {
    const m = await mountCards(['a'], {
      refreshInterval: 40,
      wrap: false,
      pollingActive: false,
    })
    try {
      await m.wait(10)
      expect(fetches).toHaveLength(1)
      expect(m.intervals()).toEqual([false])
    } finally {
      await m.cleanup()
    }
  })

  test('scrolling in refetches once when the data is older than the interval', async () => {
    const m = await mountCards(['a'], { refreshInterval: 150, wrap: true })
    try {
      await m.setVisible(false)
      await m.wait(400)
      const before = fetches.length
      await m.setVisible(true)
      await m.wait(20)
      expect(fetches.length).toBe(before + 1)
    } finally {
      await m.cleanup()
    }
  })

  test('scrolling in does not refetch immediately when the data is fresh', async () => {
    const m = await mountCards(['a'], { refreshInterval: 400, wrap: true })
    try {
      await m.wait(20)
      await m.setVisible(false)
      await m.wait(20)
      const before = fetches.length
      await m.setVisible(true)
      await m.wait(30)
      expect(fetches.length).toBe(before)
      // ...but it still catches up once the data reaches one interval of age.
      await m.wait(400)
      expect(fetches.length).toBeGreaterThan(before)
    } finally {
      await m.cleanup()
    }
  })

  test('3 off-screen cards arm no interval fetches across 5 intervals (vs 15 without)', async () => {
    const names = ['a', 'b', 'c']
    // Each tick, every observer whose interval is armed fires one fetch.
    const run = async (wrap: boolean) => {
      const m = await mountCards(names, { refreshInterval: 60, wrap })
      try {
        await m.setVisible(false)
        await m.wait(20)
        let refetches = 0
        for (let tick = 0; tick < 5; tick++) {
          refetches += m.intervals().filter((i) => i !== false).length
        }
        return refetches
      } finally {
        await m.cleanup()
      }
    }
    const without = await run(false)
    const withBoundary = await run(true)
    console.log(
      `offscreen-polling: refetches over 5 intervals, 3 cards: before=${without} after=${withBoundary}`
    )
    expect(without).toBe(15)
    expect(withBoundary).toBe(0)
  })
})
