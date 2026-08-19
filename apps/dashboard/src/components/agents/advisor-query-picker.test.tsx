/**
 * Advisor "Pick a query" dialog: empty / error / demo_hidden / list,
 * human Select labels, and include-self control. happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'
import type { HistoryQueryRow } from '@/lib/ai/advisor/history-picker'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

mock.module('@/lib/swr', () => ({
  useHostId: () => 0,
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

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

const SAMPLE_ROW: HistoryQueryRow = {
  query_id: 'abc-123',
  query: 'SELECT count() FROM events WHERE ts > now() - INTERVAL 1 HOUR',
  user: 'default',
  query_duration_ms: 1840,
  event_time: '2026-08-19 12:00:00',
  read_rows: 42000,
}

type HistoryPayload = {
  success: boolean
  data?: HistoryQueryRow[] | string[]
  error?: { message?: string }
  metadata?: { unavailable?: { reason: string; message: string } }
}

let historyPayload: HistoryPayload = { success: true, data: [] }
let historyStatus = 200
let fetchMock: ReturnType<typeof mock>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  historyPayload = { success: true, data: [] }
  historyStatus = 200
  fetchMock = mock(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('facet=users')) {
      return jsonResponse({ success: true, data: ['default', 'readonly'] })
    }
    return jsonResponse(historyPayload, historyStatus)
  })
  globalThis.fetch = fetchMock as typeof fetch
})

afterEach(() => {
  document.body.replaceChildren()
})

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

async function openPicker() {
  const { act } = await import('react')
  const onPick = mock((sql: string) => sql)
  const { AdvisorQueryPicker } = await import('./advisor-query-picker')
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const { cleanup } = await renderInto(
    <QueryClientProvider client={queryClient}>
      <AdvisorQueryPicker onPick={onPick} />
    </QueryClientProvider>
  )

  const trigger = document.querySelector(
    '[data-testid="advisor-query-picker-trigger"]'
  ) as HTMLButtonElement | null
  expect(trigger).not.toBeNull()

  await act(async () => {
    trigger?.click()
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  return { onPick, cleanup }
}

async function openHistoryTab() {
  const { act } = await import('react')
  const tab = document.querySelector(
    '[data-testid="advisor-query-picker-tab-history"]'
  ) as HTMLElement | null
  expect(tab).not.toBeNull()
  await act(async () => {
    tab?.click()
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('AdvisorQueryPicker', () => {
  test('empty history shows EmptyState copy, never a blank box', async () => {
    historyPayload = { success: true, data: [] }
    const { cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const list = document.querySelector(
        '[data-testid="advisor-query-picker-history-list"]'
      )
      expect(list).not.toBeNull()
      expect(list?.textContent).toContain('No queries found')
      expect(list?.textContent).toContain('Include dashboard queries')
      expect(list?.querySelector('[data-slot="scroll-area"]')).toBeNull()
    } finally {
      await cleanup()
    }
  })

  test('error shows EmptyState with the server message', async () => {
    historyPayload = {
      success: false,
      error: { message: 'query_log is disabled' },
    }
    historyStatus = 503
    const { cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const list = document.querySelector(
        '[data-testid="advisor-query-picker-history-list"]'
      )
      expect(list?.textContent).toContain("Couldn't load queries")
      expect(list?.textContent).toContain('query_log is disabled')
    } finally {
      await cleanup()
    }
  })

  test('demo_hidden is surfaced instead of a blank list', async () => {
    historyPayload = {
      success: true,
      data: [],
      metadata: {
        unavailable: {
          reason: 'demo_hidden',
          message: 'The demo host is hidden for signed-in accounts.',
        },
      },
    }
    const { cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const list = document.querySelector(
        '[data-testid="advisor-query-picker-history-list"]'
      )
      expect(list?.textContent).toContain('Demo host is hidden')
      expect(list?.textContent).toContain(
        'The demo host is hidden for signed-in accounts.'
      )
    } finally {
      await cleanup()
    }
  })

  test('a non-empty list renders rows and onPick fills the advisor input', async () => {
    historyPayload = { success: true, data: [SAMPLE_ROW] }
    const { onPick, cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const row = document.querySelector(
        '[data-testid="advisor-query-row"]'
      ) as HTMLButtonElement | null
      expect(row).not.toBeNull()
      expect(row?.textContent).toContain('SELECT count() FROM events')

      const { act } = await import('react')
      await act(async () => {
        row?.click()
      })
      expect(onPick).toHaveBeenCalledTimes(1)
      expect(onPick.mock.calls[0]?.[0]).toBe(SAMPLE_ROW.query)
    } finally {
      await cleanup()
    }
  })

  test('Time / User / Kind show human labels, not raw values', async () => {
    historyPayload = { success: true, data: [] }
    const { cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const hours = document.querySelector(
        '[data-testid="advisor-query-picker-hours"]'
      )
      const user = document.querySelector(
        '[data-testid="advisor-query-picker-user"]'
      )
      const kind = document.querySelector(
        '[data-testid="advisor-query-picker-kind"]'
      )
      expect(hours?.textContent).toContain('Last 24 hours')
      expect(user?.textContent).toContain('All users')
      expect(user?.textContent).not.toContain('__all__')
      expect(kind?.textContent).toContain('All kinds')
    } finally {
      await cleanup()
    }
  })

  test('include-self is off by default and history requests omit includeSelf', async () => {
    historyPayload = { success: true, data: [] }
    const { cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const toggle = document.querySelector(
        '[data-testid="advisor-query-picker-include-self"]'
      )
      expect(toggle).not.toBeNull()
      expect(toggle?.getAttribute('data-checked')).not.toBe('')
      expect(toggle?.getAttribute('aria-checked')).not.toBe('true')

      const browseUrls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter(
          (url) =>
            url.includes('/api/v1/advisor/history') && url.includes('limit=50')
        )
      expect(browseUrls.length).toBeGreaterThan(0)
      expect(browseUrls.every((url) => !url.includes('includeSelf'))).toBe(true)
      expect(browseUrls.every((url) => !url.includes('kind='))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('turning on include-self refetches with includeSelf=1', async () => {
    historyPayload = { success: true, data: [] }
    const { cleanup } = await openPicker()
    try {
      await openHistoryTab()
      const toggle = document.querySelector(
        '[data-testid="advisor-query-picker-include-self"]'
      ) as HTMLElement | null
      expect(toggle).not.toBeNull()

      const { act } = await import('react')
      await act(async () => {
        toggle?.click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      const withSelf = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((url) => url.includes('includeSelf=1'))
      expect(withSelf.length).toBeGreaterThan(0)
    } finally {
      await cleanup()
    }
  })

  test('dialog chrome stays put; the list is the scroll container', async () => {
    historyPayload = { success: true, data: [SAMPLE_ROW] }
    const { cleanup } = await openPicker()
    try {
      const dialog = document.querySelector(
        '[data-testid="advisor-query-picker-dialog"]'
      )
      const header = dialog?.querySelector('[data-slot="dialog-header"]')
      const list = document.querySelector(
        '[data-testid="advisor-query-picker-list"]'
      )
      expect(dialog?.className).toContain('flex-col')
      expect(dialog?.className).toContain('overflow-hidden')
      expect(dialog?.className).toContain('sm:max-w-2xl')
      expect(header?.className).toContain('shrink-0')
      expect(list?.className).toContain('min-h-0')
      expect(list?.className).toContain('overflow-y-auto')
      expect(list?.querySelector('[data-slot="scroll-area"]')).toBeNull()
    } finally {
      await cleanup()
    }
  })
})
