/**
 * WidgetStat error state: a raw ClickHouse failure (long TIMEOUT_EXCEEDED
 * text) must show the friendly, classified copy, not the server message.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const RAW =
  'Code: 159. DB::Exception: Timeout exceeded: elapsed 30.001 seconds, maximum: 30. (TIMEOUT_EXCEEDED) (version 24.8.1.1)'

mock.module('@/lib/swr', () => ({ useHostId: () => 0 }))
mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: async () =>
    new Response(JSON.stringify({ success: false, error: { message: RAW } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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

describe('WidgetStat error', () => {
  test('renders friendly timeout copy instead of the raw server message', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { WidgetStat } = await import('./widget-stat')
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <WidgetStat
            widget={
              {
                id: 'w1',
                type: 'stat',
                props: { statQuery: 'SELECT 1' },
              } as never
            }
          />
        </QueryClientProvider>
      )
    })
    for (let i = 0; i < 20 && !container.textContent; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25))
      })
    }

    const text = container.textContent ?? ''
    expect(text).toContain('Failed to load')
    expect(text).toContain('The query took too long to execute')
    expect(text).not.toContain('TIMEOUT_EXCEEDED')

    await act(async () => root.unmount())
  })
})
