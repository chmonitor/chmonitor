/**
 * More pages: shown when the workspace hide list is non-empty, opens
 * Settings → Navigation. happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

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

describe('MorePagesButton', () => {
  test('renders when pages are hidden and is a 44px-high control', async () => {
    const { MorePagesButton } = await import('./more-pages-button')
    const { SidebarProvider } = await import('@/components/ui/sidebar')
    const { USER_SETTINGS_QUERY_KEY } = await import(
      '@/lib/hooks/use-user-settings'
    )
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)

    const { container, cleanup } = await renderInto(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <MorePagesButton />
        </SidebarProvider>
      </QueryClientProvider>
    )

    try {
      const button = container.querySelector(
        '[data-testid="more-pages-button"]'
      ) as HTMLButtonElement | null
      expect(button).not.toBeNull()
      expect(button?.tagName).toBe('BUTTON')
      expect(button?.textContent).toContain('More pages')
      expect(button?.className).toContain('min-h-11')
    } finally {
      await cleanup()
    }
  })

  test('is absent on Full with an empty hide list', async () => {
    const { MorePagesButton } = await import('./more-pages-button')
    const { SidebarProvider } = await import('@/components/ui/sidebar')
    const { USER_SETTINGS_QUERY_KEY } = await import(
      '@/lib/hooks/use-user-settings'
    )
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, {
      ...DEFAULT_USER_SETTINGS,
      workspacePreset: 'full',
      hiddenMenuHrefs: [],
    })

    const { container, cleanup } = await renderInto(
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <MorePagesButton />
        </SidebarProvider>
      </QueryClientProvider>
    )

    try {
      expect(container.querySelector('[data-testid="more-pages-button"]')).toBe(
        null
      )
    } finally {
      await cleanup()
    }
  })
})
