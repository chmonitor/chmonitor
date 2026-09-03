/**
 * Hover-Add: + opens hidden siblings; clicking a leaf calls showMenuHref.
 * happy-dom + react-dom/client.
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

describe('AddButton', () => {
  test('opens hidden siblings and showMenuHref adds Failed to the rail', async () => {
    const { AddButton } = await import('./add-button')
    const { SidebarProvider, SidebarMenu, SidebarMenuItem } = await import(
      '@/components/ui/sidebar'
    )
    const { USER_SETTINGS_QUERY_KEY } = await import(
      '@/lib/hooks/use-user-settings'
    )
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')
    const { persistShowMenuHref } = await import('@/lib/menu/hide-menu-item')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(USER_SETTINGS_QUERY_KEY, DEFAULT_USER_SETTINGS)
    expect(DEFAULT_USER_SETTINGS.hiddenMenuHrefs).toContain('/failed-queries')

    const {
      RouterContextProvider,
      createMemoryHistory,
      createRootRoute,
      createRouter,
    } = await import('@tanstack/react-router')
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    const { container, cleanup } = await renderInto(
      <RouterContextProvider router={router}>
        <QueryClientProvider client={queryClient}>
          <SidebarProvider>
            <SidebarMenu>
              <SidebarMenuItem>
                <AddButton href="/running-queries" />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarProvider>
        </QueryClientProvider>
      </RouterContextProvider>
    )

    try {
      const trigger = container.querySelector(
        '[data-testid="add-menu-item"]'
      ) as HTMLButtonElement | null
      expect(trigger).not.toBeNull()
      expect(trigger?.className).toContain('max-lg:hidden')

      const { act } = await import('react')
      await act(async () => {
        trigger?.click()
      })

      const failed = document.querySelector(
        '[data-testid="hidden-page-add"][data-href="/failed-queries"]'
      ) as HTMLButtonElement | null
      expect(failed).not.toBeNull()

      await act(async () => {
        failed?.click()
      })

      const stored = queryClient.getQueryData(USER_SETTINGS_QUERY_KEY) as {
        hiddenMenuHrefs: string[]
      }
      expect(stored.hiddenMenuHrefs).not.toContain('/failed-queries')
      expect(
        persistShowMenuHref(DEFAULT_USER_SETTINGS, '/failed-queries')
          .hiddenMenuHrefs
      ).not.toContain('/failed-queries')
    } finally {
      await cleanup()
    }
  })
})
