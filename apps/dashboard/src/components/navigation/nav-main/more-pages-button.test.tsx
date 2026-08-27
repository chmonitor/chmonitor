/**
 * More flyout: shown when the workspace hide list is non-empty. Click opens
 * the catalog, not Settings. happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement, ReactNode } from 'react'

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

mock.module('@/components/menu/link-with-context', () => ({
  HostPrefixedLink: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string
    children?: ReactNode
    className?: string
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
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
      expect(button?.textContent).toContain('More')
      expect(button?.textContent).not.toContain('More pages')
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

  test('opens a searchable flyout of hidden pages, not Settings', async () => {
    const { MorePagesButton } = await import('./more-pages-button')
    const { SidebarProvider } = await import('@/components/ui/sidebar')
    const { USER_SETTINGS_QUERY_KEY } = await import(
      '@/lib/hooks/use-user-settings'
    )
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')
    const {
      RouterContextProvider,
      createMemoryHistory,
      createRootRoute,
      createRouter,
    } = await import('@tanstack/react-router')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    const { container, cleanup } = await renderInto(
      <RouterContextProvider router={router}>
        <QueryClientProvider client={queryClient}>
          <SidebarProvider>
            <MorePagesButton />
          </SidebarProvider>
        </QueryClientProvider>
      </RouterContextProvider>
    )

    try {
      const button = container.querySelector(
        '[data-testid="more-pages-button"]'
      ) as HTMLButtonElement | null
      expect(button).not.toBeNull()

      const { act } = await import('react')
      await act(async () => {
        button?.click()
      })

      const panel = document.querySelector('[data-testid="more-pages-panel"]')
      expect(panel).not.toBeNull()
      expect(
        document.querySelector('[data-testid="more-pages-search"]')
      ).not.toBeNull()
      expect(
        document.querySelector(
          '[data-testid="hidden-page-add"][data-href="/failed-queries"]'
        )
      ).not.toBeNull()
      expect(
        document.querySelector('[data-testid="more-pages-customize"]')
      ).not.toBeNull()
      expect(
        document.querySelector('[data-testid="more-pages-show-all"]')
      ).not.toBeNull()
      expect(document.querySelector('[data-testid="settings-dialog"]')).toBe(
        null
      )
    } finally {
      await cleanup()
    }
  })
})
