/**
 * Collapsible group follows client-side navigation: landing on a child
 * (palette, breadcrumb, in-page link) opens the parent so the active row is
 * visible, and a user collapse survives until the location changes again.
 * happy-dom + react-dom/client.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ReactElement, ReactNode } from 'react'
import type { MenuItem as MenuItemType } from '@/components/menu/types'

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

mock.module('@/components/menu/hooks/use-table-availability', () => ({
  useIsTableAvailable: () => ({ available: true, isLoading: false }),
}))

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

afterEach(() => {
  document.body.replaceChildren()
})

const queriesGroup: MenuItemType = {
  title: 'Queries',
  href: '/running-queries',
  items: [
    { title: 'Running Queries', href: '/running-queries' },
    { title: 'History Queries', href: '/history-queries' },
  ],
}

async function mount() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MenuItem } = await import('./menu-item')
  const { SidebarProvider, SidebarMenu } = await import(
    '@/components/ui/sidebar'
  )
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

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  const tree = (pathname: string): ReactElement => (
    <RouterContextProvider router={router}>
      <QueryClientProvider client={queryClient}>
        <SidebarProvider>
          <SidebarMenu>
            <MenuItem item={queriesGroup} pathname={pathname} />
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    </RouterContextProvider>
  )

  const render = async (pathname: string) => {
    await act(async () => {
      root.render(tree(pathname))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const subLinks = () =>
    [...container.querySelectorAll('[data-sidebar="menu-sub"] a')].map((a) =>
      a.getAttribute('href')
    )

  const trigger = () =>
    container.querySelector(
      '[data-slot="collapsible-trigger"]'
    ) as HTMLButtonElement

  const cleanup = async () => {
    await act(async () => {
      root.unmount()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    container.remove()
  }

  return { render, subLinks, trigger, cleanup, act }
}

describe('MenuItem collapsible group', () => {
  test('opens when navigation lands on a child after mount', async () => {
    const m = await mount()
    try {
      await m.render('/overview')
      expect(m.subLinks()).toEqual([])

      await m.render('/history-queries')
      expect(m.subLinks()).toContain('/history-queries')
    } finally {
      await m.cleanup()
    }
  })

  test('user collapse holds until the location changes', async () => {
    const m = await mount()
    try {
      await m.render('/running-queries')
      expect(m.subLinks()).toContain('/running-queries')

      await m.act(async () => {
        m.trigger().click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(m.subLinks()).toEqual([])

      await m.render('/running-queries')
      expect(m.subLinks()).toEqual([])

      await m.render('/history-queries')
      expect(m.subLinks()).toContain('/history-queries')
    } finally {
      await m.cleanup()
    }
  })
})
