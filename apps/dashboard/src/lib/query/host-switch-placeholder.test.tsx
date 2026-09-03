/**
 * Switching host A → B must not render A's rows under B. The chart/table
 * hooks keep previous data as a placeholder across key changes; that
 * placeholder must stay scoped to the same host. happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'

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

const pending = new Set<() => void>()

mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: async (url: string) => {
    const hostId = new URL(url, 'http://x').searchParams.get('hostId')
    if (hostId === '0') {
      return new Response(
        JSON.stringify({ data: [{ host: 'A', value: 42 }], metadata: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }
    await new Promise<void>((resolve) => pending.add(resolve))
    return new Response(JSON.stringify({ error: 'refused' }), { status: 503 })
  },
}))

mock.module('@/lib/swr/use-merged-hosts', () => ({
  isServerHost: () => true,
  useMergedHosts: () => ({
    hosts: [
      { id: 0, name: 'A', host: 'http://a', source: 'env' },
      { id: 1, name: 'B', host: 'http://b', source: 'env' },
    ],
    getConnectionByHostId: () => null,
  }),
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  for (const resolve of pending) resolve()
  pending.clear()
  document.body.replaceChildren()
})

async function mount(render: (hostId: number) => ReactElement) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const show = async (hostId: number) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          {render(hostId)}
        </QueryClientProvider>
      )
    })
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      if (!container.textContent?.includes('loading')) break
    }
    return container.textContent ?? ''
  }
  const cleanup = async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  }
  return { show, cleanup }
}

describe('host switch keeps placeholder data scoped to the host', () => {
  test('useChartData drops host A rows once hostId becomes B', async () => {
    const { useChartData } = await import('./use-chart-data')
    function Probe({ hostId }: { hostId: number }) {
      const { data, hasData, isLoading } = useChartData<{ host: string }>({
        chartName: 'query-count',
        hostId,
        refreshInterval: 0,
      })
      return (
        <output>
          {isLoading ? 'loading' : 'idle'} hasData={String(hasData)}{' '}
          {data.map((row) => row.host).join(',')}
        </output>
      )
    }
    const m = await mount((hostId) => <Probe hostId={hostId} />)
    try {
      const a = await m.show(0)
      expect(a).toContain('hasData=true')
      expect(a).toContain('A')

      const b = await m.show(1)
      expect(b).toContain('loading')
      expect(b).not.toContain('A')
      expect(b).toContain('hasData=false')
    } finally {
      await m.cleanup()
    }
  })

  test('useTableData drops host A rows once hostId becomes B', async () => {
    const { useTableData } = await import('./use-table-data')
    function Probe({ hostId }: { hostId: number }) {
      const { data, hasData, isLoading } = useTableData<{ host: string }>(
        'running-queries',
        hostId,
        undefined,
        0
      )
      return (
        <output>
          {isLoading ? 'loading' : 'idle'} hasData={String(hasData)}{' '}
          {data.map((row) => row.host).join(',')}
        </output>
      )
    }
    const m = await mount((hostId) => <Probe hostId={hostId} />)
    try {
      const a = await m.show(0)
      expect(a).toContain('hasData=true')
      expect(a).toContain('A')

      const b = await m.show(1)
      expect(b).toContain('loading')
      expect(b).not.toContain('A')
      expect(b).toContain('hasData=false')
    } finally {
      await m.cleanup()
    }
  })

  test('same host, new time range still keeps the previous rows', async () => {
    const { useChartData } = await import('./use-chart-data')
    function Probe({ lastHours }: { lastHours: number }) {
      const { data } = useChartData<{ host: string }>({
        chartName: 'query-count',
        hostId: 0,
        lastHours,
        refreshInterval: 0,
      })
      return <output>{data.map((row) => row.host).join(',')}</output>
    }
    const m = await mount((lastHours) => <Probe lastHours={lastHours} />)
    try {
      expect(await m.show(24)).toContain('A')
      expect(await m.show(168)).toContain('A')
    } finally {
      await m.cleanup()
    }
  })
})
