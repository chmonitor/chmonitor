/**
 * History row actions must stay visible on a coarse pointer (#3614).
 * Touch has no hover, so a bare opacity-0 until group-hover can never be tapped.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'
import type { QueryHistoryEntry } from './hooks/use-query-history'

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

const serverHistoryBody = {
  success: true,
  data: [
    {
      query_id: 'q1',
      query: 'SELECT 2',
      event_time: '2026-01-01 00:00:00',
      query_duration_ms: 10,
      read_rows: 2,
    },
  ],
}

mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: async () => ({
    json: async () => serverHistoryBody,
  }),
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
  }

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as typeof window.matchMedia
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

function tokens(el: Element | null): string[] {
  return (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

function historyEntry(): QueryHistoryEntry {
  return {
    id: '1',
    sql: 'SELECT 1',
    hostId: 0,
    database: null,
    ts: Date.now(),
    ok: true,
    rows: 1,
  }
}

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

async function renderInto(
  node: ReactElement
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

describe('QueryHistoryPanel touch actions', () => {
  test('Mine run, pin, and remove stay visible and keep a coarse hit target', async () => {
    const onSelect = mock(() => {})
    const onRemove = mock(() => {})
    const onTogglePin = mock(() => {})
    const onClear = mock(() => {})
    const { QueryHistoryPanel } = await import('./query-history-panel')
    const { container, cleanup } = await renderInto(
      <QueryClientProvider client={queryClient()}>
        <QueryHistoryPanel
          hostId={0}
          serverEnabled={false}
          entries={[historyEntry()]}
          onSelect={onSelect}
          onRemove={onRemove}
          onTogglePin={onTogglePin}
          onClear={onClear}
        />
      </QueryClientProvider>
    )

    const run = container.querySelector(
      '[aria-label="Run"]'
    ) as HTMLButtonElement
    expect(run).toBeTruthy()
    const clusterTokens = tokens(run.parentElement)
    expect(clusterTokens).not.toContain('opacity-0')
    expect(clusterTokens).toContain('pointer-fine:opacity-0')
    expect(clusterTokens).toContain('opacity-40')
    expect(clusterTokens).toContain('pointer-fine:group-hover:opacity-100')
    expect(clusterTokens).toContain(
      'pointer-fine:group-focus-within:opacity-100'
    )

    for (const label of ['Run', 'Pin', 'Remove']) {
      const button = container.querySelector(`[aria-label="${label}"]`)
      expect(tokens(button)).toContain('pointer-coarse:size-9')
      expect(tokens(button)).toContain('size-6')
    }

    const { act } = await import('react')
    await act(async () => {
      run.click()
    })
    expect(onSelect).toHaveBeenCalledWith('SELECT 1', true)

    const pin = container.querySelector(
      '[aria-label="Pin"]'
    ) as HTMLButtonElement
    await act(async () => {
      pin.click()
    })
    expect(onTogglePin).toHaveBeenCalledWith('1')

    const remove = container.querySelector(
      '[aria-label="Remove"]'
    ) as HTMLButtonElement
    await act(async () => {
      remove.click()
    })
    expect(onRemove).toHaveBeenCalledWith('1')

    await cleanup()
  })

  test('Server run stays visible and keeps a coarse hit target', async () => {
    const onSelect = mock(() => {})
    const { QueryHistoryPanel } = await import('./query-history-panel')
    const { container, cleanup } = await renderInto(
      <QueryClientProvider client={queryClient()}>
        <QueryHistoryPanel
          hostId={0}
          serverEnabled
          entries={[]}
          onSelect={onSelect}
          onRemove={mock(() => {})}
          onTogglePin={mock(() => {})}
          onClear={mock(() => {})}
        />
      </QueryClientProvider>
    )

    const serverTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Server'
    )
    expect(serverTab).toBeTruthy()

    const { act } = await import('react')
    await act(async () => {
      serverTab?.click()
    })

    const started = Date.now()
    let run: HTMLButtonElement | null = null
    while (Date.now() - started < 2000) {
      run = container.querySelector('[aria-label="Run"]')
      if (run && container.textContent?.includes('SELECT 2')) break
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }

    expect(run).toBeTruthy()
    expect(container.textContent).toContain('SELECT 2')
    const runTokens = tokens(run)
    expect(runTokens).not.toContain('opacity-0')
    expect(runTokens).toContain('pointer-fine:opacity-0')
    expect(runTokens).toContain('pointer-coarse:size-9')
    expect(runTokens).toContain('size-6')
    expect(runTokens).toContain('opacity-40')

    await cleanup()
  })
})
