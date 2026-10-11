/**
 * QueryDetailView error state: friendly copy via EmptyState + a Retry that
 * calls the table-data refresh.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

const RAW =
  'Code: 159. DB::Exception: Timeout exceeded: elapsed 30.001 seconds, maximum: 30. (TIMEOUT_EXCEEDED) (version 24.8.1.1)'
const refresh = mock(() => {})

mock.module('@/lib/swr/use-host', () => ({ useHostId: () => 0 }))
mock.module('@/lib/query/use-table-data', () => ({
  useTableData: () => ({
    data: undefined,
    isLoading: false,
    error: new Error(RAW),
    refresh,
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

describe('QueryDetailView error', () => {
  test('shows friendly copy and Retry triggers refresh', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { QueryDetailView } = await import('./query-detail-view')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<QueryDetailView queryId="abc" />)
    })

    const text = container.textContent ?? ''
    expect(text).toContain('The query took too long to execute')
    expect(text).not.toContain('TIMEOUT_EXCEEDED')

    const retry = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Retry')
    )
    expect(retry).toBeDefined()
    await act(async () => {
      retry?.click()
    })
    expect(refresh).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
  })
})
